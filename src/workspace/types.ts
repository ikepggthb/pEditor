import type { FileEntry, RepositoryInfo } from '../repo/types.ts';

/**
 * How a file in the workspace differs from the revision it came from.
 *
 * `added` and `deleted` are not produced yet — nothing creates or removes a
 * file inside a repository workspace — but a commit has to be able to describe
 * them, so the vocabulary is here from the start rather than being retrofitted
 * through every switch that reads it.
 */
export type FileStatus = 'unchanged' | 'modified' | 'added' | 'deleted';

export interface WorkspaceFile {
  path: string;
  /**
   * The content as the repository had it, at `baseCommit`.
   *
   * Kept alongside the edited copy so `modified` is derived by comparison
   * rather than trusted from a flag that can drift — and so a diff has both
   * sides without going back to the network.
   */
  original: string;
  /** What the editor is showing, and what gets committed. */
  content: string;
  /** `null` for a file that only exists on this device. */
  languageId?: string;
  updatedAt: number;
}

export interface WorkspaceMeta {
  id: string;
  repository: RepositoryInfo;
  /** Last file shown, so reopening the app lands where it was left. */
  activePath: string | null;
  openedAt: number;
  updatedAt: number;
}

/** One directory's entries as fetched, cached so browsing back costs nothing. */
export interface CachedListing {
  workspaceId: string;
  path: string;
  entries: FileEntry[];
  fetchedAt: number;
}

export function statusOf(file: WorkspaceFile): FileStatus {
  return file.content === file.original ? 'unchanged' : 'modified';
}
