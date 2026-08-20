import type { RepositoryRef } from './types.ts';

/**
 * Turn whatever the user pasted into a repository reference.
 *
 * People arrive with a browser URL, and browser URLs point at whatever they
 * were looking at — a branch, a directory, a line of a file. All of those
 * should open the repository and land on that spot, so the path is kept rather
 * than discarded.
 *
 * Accepted, with or without scheme, `www.` or a trailing `.git`:
 *
 *   github.com/owner/repo
 *   github.com/owner/repo/tree/main
 *   github.com/owner/repo/tree/main/src/parser
 *   github.com/owner/repo/blob/main/src/parser/mod.rs#L42
 *   owner/repo
 */
export function parseRepositoryUrl(input: string): RepositoryRef | null {
  const text = input.trim();
  if (!text) return null;

  // `owner/repo` on its own, which is how people say it out loud.
  const short = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(text);
  if (short) return { provider: 'github', owner: short[1], repo: short[2] };

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'github.com') return null;

  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (segments.length < 2) return null;

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');
  const ref: RepositoryRef = { provider: 'github', owner, repo };

  // `/tree/` and `/blob/` are followed by a ref and then a path. A branch name
  // may itself contain slashes, and nothing in the URL says where it ends —
  // `tree/feature/x/src` is ambiguous. The first segment is taken as the ref,
  // which is right for the overwhelming majority; a branch with a slash in it
  // can still be reached by opening the repository and switching to it.
  const kind = segments[2];
  if ((kind === 'tree' || kind === 'blob') && segments.length >= 4) {
    ref.branch = segments[3];
    const path = segments.slice(4).join('/');
    if (path) ref.path = path;
  }
  return ref;
}
