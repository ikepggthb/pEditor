import { GitHubRepositoryProvider, searchGitHubRepositories } from './github.ts';
import { LocalRepositoryProvider } from './local.ts';
import {
  type RepositoryInfo,
  type RepositoryProvider,
  type RepositoryRef,
  type RepositorySummary,
  RepositoryError,
} from './types.ts';

/**
 * The one place that maps a reference to an implementation.
 *
 * Adding GitLab, a zip file or the File System Access API means adding a case
 * here and a file beside it. Nothing above this line changes.
 */
export async function providerFor(ref: RepositoryRef): Promise<RepositoryProvider> {
  switch (ref.provider) {
    case 'github':
      return GitHubRepositoryProvider.open(ref);
    case 'local':
      return new LocalRepositoryProvider();
    default:
      throw new RepositoryError('unsupported', 'That kind of repository is not supported yet.');
  }
}

/**
 * Rebuild a provider from what a stored workspace already knows, without
 * asking the network anything. `null` when that is not possible for this kind
 * of repository, in which case the caller resolves it the long way.
 */
export function providerFrom(info: RepositoryInfo): RepositoryProvider | null {
  if (info.provider === 'local') return new LocalRepositoryProvider();
  return GitHubRepositoryProvider.restore(info);
}

/**
 * Find repositories to open. Only GitHub can answer this today; another
 * provider would add a case here alongside its own implementation.
 */
export function searchRepositories(query: string, signal?: AbortSignal): Promise<RepositorySummary[]> {
  return searchGitHubRepositories(query, signal);
}

export * from './types.ts';
export { parseRepositoryUrl } from './url.ts';
