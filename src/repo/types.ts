/**
 * The boundary between the app and wherever code comes from.
 *
 * Nothing above this layer knows what GitHub is. That is the point: the editor
 * edits text, the workspace tracks what has been opened and changed, and only
 * an implementation of `RepositoryProvider` knows about owners, refs, blobs or
 * rate limits. Adding GitLab, a zip file or the local filesystem later means
 * adding a file here and nothing else.
 */

export type ProviderId = 'github' | 'local';

/** What the user asked for, before anything has been resolved. */
export interface RepositoryRef {
  provider: ProviderId;
  owner?: string;
  repo?: string;
  /** Branch or tag. Absent means "whatever the repository calls its default". */
  branch?: string;
  /** A path the URL pointed at, so opening a link to a file lands on it. */
  path?: string;
}

/**
 * A ref that has been pinned against the remote.
 *
 * `baseCommit` is what makes a workspace mean something later: the branch can
 * move under us, and when it does we still know which state the edits were
 * made against.
 */
export interface RepositoryInfo {
  provider: ProviderId;
  owner?: string;
  repo?: string;
  branch?: string;
  baseCommit?: string;
  /** For display, e.g. `rust-lang/rust`. */
  name: string;
}

export interface FileEntry {
  /** Path from the repository root. No leading slash; '' is the root itself. */
  path: string;
  name: string;
  type: 'file' | 'directory';
  /** Bytes, when the provider happens to know without fetching the content. */
  size?: number;
}

/** A repository found by searching, before anything has been fetched from it. */
export interface RepositorySummary {
  provider: ProviderId;
  owner: string;
  repo: string;
  /** `owner/repo`, for display. */
  name: string;
  description?: string;
  stars?: number;
  language?: string;
}

export interface RepositoryProvider {
  readonly info: RepositoryInfo;

  /**
   * One directory's entries, not the whole tree.
   *
   * A recursive tree is a single request, which is tempting — but for a large
   * repository it is megabytes of JSON that GitHub then truncates anyway, and
   * parsing that on a phone before showing anything is exactly what this app
   * is meant not to do. A directory at a time is bounded, never truncated, and
   * matches how the tree is actually walked. If a future feature needs the
   * whole tree (a global file filter), it belongs beside this as its own
   * method, so the cost is paid only where it buys something.
   */
  listDirectory(path: string): Promise<FileEntry[]>;

  readFile(path: string): Promise<string>;
}

/** Something the user has to be told about, rather than a bug. */
export class RepositoryError extends Error {
  readonly kind: 'not-found' | 'rate-limited' | 'network' | 'too-large' | 'binary' | 'unsupported';

  constructor(kind: RepositoryError['kind'], message: string) {
    super(message);
    this.name = 'RepositoryError';
    this.kind = kind;
  }
}

/** Stable identity for a workspace, and its key in IndexedDB. */
export function workspaceId(info: RepositoryInfo | RepositoryRef): string {
  if (info.provider === 'local') return 'local';
  return `${info.provider}:${info.owner}/${info.repo}@${info.branch ?? 'HEAD'}`;
}

/** The directory containing `path`, or '' for a top-level entry. */
export function parentPath(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

export function baseName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}
