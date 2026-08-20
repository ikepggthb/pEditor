import type { FileEntry, RepositoryInfo, RepositoryProvider } from './types.ts';

/**
 * Files that exist only on this device.
 *
 * Scratch documents are a provider like any other rather than a special case
 * outside the model, which is what keeps `Workspace` from growing a branch for
 * "the one without a repository". There is nothing to fetch, so both methods
 * are answered by the workspace's own store before they are ever reached.
 */
export class LocalRepositoryProvider implements RepositoryProvider {
  readonly info: RepositoryInfo = { provider: 'local', name: 'On this device' };

  async listDirectory(): Promise<FileEntry[]> {
    return [];
  }

  async readFile(): Promise<string> {
    return '';
  }
}
