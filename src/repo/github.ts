import {
  type FileEntry,
  type RepositoryInfo,
  type RepositoryProvider,
  type RepositoryRef,
  RepositoryError,
  baseName,
} from './types.ts';

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

/**
 * Anything bigger than this is not something to read on a phone, and turning
 * it into a DOM would take the tab down. Refused with an explanation instead.
 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

interface TreeResponse {
  tree?: { path: string; type: string; sha: string; size?: number }[];
  truncated?: boolean;
}

async function getJson<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  } catch {
    throw new RepositoryError('network', 'Could not reach GitHub.');
  }

  if (response.ok) return (await response.json()) as T;
  if (response.status === 404) throw new RepositoryError('not-found', 'Not found on GitHub.');
  if (response.status === 403 || response.status === 429) {
    // Unauthenticated callers get 60 requests an hour, per address. Worth
    // naming, because the fix is to wait rather than to try again.
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const remaining = response.headers.get('x-ratelimit-remaining');
    const minutes = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : 0;
    // An anonymous 403 from this API is the hourly limit almost every time, so
    // that is what it says even when the headers are not readable — "refused"
    // on its own tells nobody what to do about it.
    throw new RepositoryError(
      'rate-limited',
      minutes && remaining === '0'
        ? `GitHub's hourly limit for anonymous requests is used up. It resets in about ${minutes} minute${minutes === 1 ? '' : 's'}.`
        : "GitHub's hourly limit for anonymous requests is used up. Try again later.",
    );
  }
  throw new RepositoryError('network', `GitHub replied ${response.status}.`);
}

/**
 * Public repositories over the REST API, read-only.
 *
 * The split between the two hosts it talks to is deliberate. Metadata comes
 * from the API, which anonymously allows sixty requests an hour — enough to
 * walk a tree, nowhere near enough to read a codebase. File contents come from
 * `raw.githubusercontent.com`, which is not on that budget at all, so reading
 * files costs nothing however many are opened. Raw also takes a commit SHA in
 * the path, which pins every read to the revision the workspace was opened at,
 * for free.
 */
export class GitHubRepositoryProvider implements RepositoryProvider {
  readonly info: RepositoryInfo;
  /** Tree SHA per directory path, so a listing can be fetched without walking. */
  private treeShas = new Map<string, string>();

  private constructor(info: RepositoryInfo, rootTreeSha: string) {
    this.info = info;
    this.treeShas.set('', rootTreeSha);
  }

  /**
   * Resolve a reference into a workspace's fixed starting point: a real branch
   * name and the commit it pointed at when it was opened.
   */
  static async open(ref: RepositoryRef): Promise<GitHubRepositoryProvider> {
    const { owner, repo } = ref;
    if (!owner || !repo) throw new RepositoryError('unsupported', 'No repository given.');

    let branch = ref.branch;
    if (!branch) {
      const meta = await getJson<{ default_branch?: string }>(`${API}/repos/${owner}/${repo}`);
      branch = meta.default_branch ?? 'main';
    }

    const commit = await getJson<{ sha?: string; commit?: { tree?: { sha?: string } } }>(
      `${API}/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`,
    );
    if (!commit.sha) throw new RepositoryError('not-found', 'That branch has no commits.');

    const rootTree = commit.commit?.tree?.sha;
    return new GitHubRepositoryProvider(
      {
        provider: 'github',
        owner,
        repo,
        branch,
        baseCommit: commit.sha,
        name: `${owner}/${repo}`,
      },
      // The commit SHA works as a tree-ish everywhere the tree API is used, so
      // a missing tree SHA costs nothing.
      rootTree ?? commit.sha,
    );
  }

  /**
   * Rebuild a provider for a workspace that has been opened before.
   *
   * No requests, which matters twice over: reopening the app works with no
   * network, and — more importantly — the base commit stays the one the edits
   * were made against. Resolving the branch again would silently move the
   * workspace onto whatever has been pushed since, and the diff would then be
   * against a revision the user never saw.
   */
  static restore(info: RepositoryInfo): GitHubRepositoryProvider | null {
    if (info.provider !== 'github' || !info.owner || !info.repo || !info.baseCommit) return null;
    // A commit SHA is a valid tree-ish for the trees API, so it stands in for a
    // root tree SHA that was never worth storing separately.
    return new GitHubRepositoryProvider(info, info.baseCommit);
  }

  async listDirectory(path: string): Promise<FileEntry[]> {
    const sha = await this.treeShaFor(path);
    const { owner, repo } = this.info;
    const response = await getJson<TreeResponse>(`${API}/repos/${owner}/${repo}/git/trees/${sha}`);

    const entries: FileEntry[] = [];
    for (const item of response.tree ?? []) {
      // Submodules ('commit') and symlinks are listed by the API and cannot be
      // read as text; leaving them out is less confusing than a dead entry.
      if (item.type !== 'blob' && item.type !== 'tree') continue;
      const full = path ? `${path}/${item.path}` : item.path;
      if (item.type === 'tree') this.treeShas.set(full, item.sha);
      entries.push({
        path: full,
        name: item.path,
        type: item.type === 'tree' ? 'directory' : 'file',
        ...(item.size !== undefined ? { size: item.size } : {}),
      });
    }
    return sortEntries(entries);
  }

  async readFile(path: string): Promise<string> {
    const { owner, repo, baseCommit, branch } = this.info;
    const ref = baseCommit ?? branch ?? 'HEAD';
    const url = `${RAW}/${owner}/${repo}/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`;

    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new RepositoryError('network', 'Could not reach GitHub.');
    }
    if (response.status === 404) throw new RepositoryError('not-found', `${baseName(path)} is not in this revision.`);
    if (!response.ok) throw new RepositoryError('network', `GitHub replied ${response.status}.`);

    const length = Number(response.headers.get('content-length'));
    if (length && length > MAX_FILE_BYTES) {
      throw new RepositoryError('too-large', `${baseName(path)} is too large to open here.`);
    }

    const text = await response.text();
    if (text.length > MAX_FILE_BYTES) {
      throw new RepositoryError('too-large', `${baseName(path)} is too large to open here.`);
    }
    // A NUL in the first stretch is the same heuristic git uses, and it is the
    // difference between saying "this is a binary file" and painting a
    // megabyte of mojibake.
    if (text.slice(0, 8000).includes('\u0000')) {
      throw new RepositoryError('binary', `${baseName(path)} looks like a binary file.`);
    }
    return text;
  }

  /**
   * The tree SHA for a directory, walking down from the root if this is the
   * first time it has been asked for. Every directory opened on the way is
   * remembered, so the walk happens once per path at most.
   */
  private async treeShaFor(path: string): Promise<string> {
    const known = this.treeShas.get(path);
    if (known) return known;
    if (!path) throw new RepositoryError('not-found', 'The repository has no tree.');

    const segments = path.split('/');
    let walked = '';
    for (const segment of segments) {
      const next = walked ? `${walked}/${segment}` : segment;
      if (!this.treeShas.has(next)) await this.listDirectory(walked);
      const sha = this.treeShas.get(next);
      if (!sha) throw new RepositoryError('not-found', `${path} is not a directory here.`);
      walked = next;
    }
    return this.treeShas.get(path) as string;
  }
}

/** Directories first, then case-insensitive by name — the usual file listing. */
export function sortEntries(entries: FileEntry[]): FileEntry[] {
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
}
