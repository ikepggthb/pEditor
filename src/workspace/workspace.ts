import {
  type FileEntry,
  type RepositoryInfo,
  type RepositoryProvider,
  type RepositoryRef,
  providerFor,
  providerFrom,
  workspaceId,
} from '../repo/index.ts';
import { WorkspaceStore } from './store.ts';
import { type FileStatus, type WorkspaceFile, type WorkspaceMeta, statusOf } from './types.ts';

/**
 * Find a stored workspace for this reference.
 *
 * A reference with no branch cannot name a workspace on its own, so pasting
 * the plain repository URL again looks for one already open on any branch.
 * Without that, the second visit would resolve the default branch afresh and
 * start a new workspace beside the one holding the edits.
 */
async function findExisting(store: WorkspaceStore, ref: RepositoryRef): Promise<WorkspaceMeta | null> {
  const direct = await store.getWorkspace(workspaceId(ref));
  if (direct) return direct;
  if (ref.provider !== 'github' || ref.branch) return null;
  const all = await store.listWorkspaces();
  return (
    all.find(
      (meta) =>
        meta.repository.provider === 'github' &&
        meta.repository.owner === ref.owner &&
        meta.repository.repo === ref.repo,
    ) ?? null
  );
}

/** Wait this long after the last keystroke before writing to IndexedDB. */
const AUTOSAVE_MS = 700;

/**
 * What the user is working on.
 *
 * Sits between the editor and wherever the code came from, and is the only
 * thing that knows both. Two rules give it its shape:
 *
 * Nothing is fetched until it is asked for. A repository is a file tree and a
 * commit SHA; file contents arrive one at a time, when opened. Downloading a
 * codebase to read one file of it is not something to do on a phone.
 *
 * Nothing that has been fetched or edited is fetched again. Every listing and
 * every file is written to IndexedDB, so going back up a directory, reopening
 * a file, or relaunching the app after the tab was discarded all cost nothing
 * and work offline.
 */
export class Workspace {
  readonly id: string;
  readonly repository: RepositoryInfo;

  private readonly provider: RepositoryProvider;
  private readonly store: WorkspaceStore;
  private files = new Map<string, WorkspaceFile>();
  private listings = new Map<string, FileEntry[]>();
  private activePath: string | null = null;
  private openedAt: number;
  private saveTimers = new Map<string, number>();

  private constructor(
    provider: RepositoryProvider,
    store: WorkspaceStore,
    meta: Pick<WorkspaceMeta, 'activePath' | 'openedAt'>,
  ) {
    this.provider = provider;
    this.store = store;
    this.repository = provider.info;
    this.id = workspaceId(provider.info);
    this.activePath = meta.activePath;
    this.openedAt = meta.openedAt;
  }

  /**
   * Open a repository, reusing whatever this device already has of it.
   *
   * A workspace that has been opened before keeps its edits and its position;
   * `baseCommit` is deliberately *not* refreshed, because the branch may have
   * moved and the edits were made against what was there at the time. Moving
   * to a newer commit is a decision, not a side effect of opening the app.
   */
  static async open(ref: RepositoryRef, store = new WorkspaceStore()): Promise<Workspace> {
    const existing = await findExisting(store, ref);

    // A known workspace is rebuilt from its own record: no requests, works
    // offline, and — the point — keeps the commit the edits were made against
    // instead of quietly moving to whatever the branch points at now.
    const provider = (existing && providerFrom(existing.repository)) ?? (await providerFor(ref));

    // Identity comes from the *resolved* repository, never from the reference.
    // A URL with no branch in it is `@HEAD` before resolving and `@main` after,
    // and writing the record under one while pointing at the other is a
    // workspace that saves correctly and is never found again.
    const id = workspaceId(provider.info);
    const record = existing ?? (await store.getWorkspace(id));

    const workspace = new Workspace(provider, store, {
      activePath: record?.activePath ?? ref.path ?? null,
      openedAt: record?.openedAt ?? Date.now(),
    });
    if (record) {
      for (const file of await store.getFiles(id)) workspace.files.set(file.path, file);
    }
    await workspace.persistMeta();
    store.rememberLast(id);
    return workspace;
  }

  /** Reopen the workspace this device was last using, if there is one. */
  static async restoreLast(store = new WorkspaceStore()): Promise<Workspace | null> {
    const id = store.lastOpened();
    if (!id) return null;
    const meta = await store.getWorkspace(id);
    if (!meta) return null;
    const { provider, owner, repo, branch } = meta.repository;
    try {
      return await Workspace.open({ provider, owner, repo, branch }, store);
    } catch {
      // Offline, or the repository has gone. A local workspace still works.
      return provider === 'local' ? Workspace.open({ provider: 'local' }, store) : null;
    }
  }

  // -------------------------------------------------------------- directory

  /** One directory's entries: from the cache if it has been seen before. */
  async list(path: string): Promise<FileEntry[]> {
    const held = this.listings.get(path);
    if (held) return held;

    const cached = await this.store.getListing(this.id, path);
    if (cached) {
      this.listings.set(path, cached.entries);
      return cached.entries;
    }

    const entries = await this.provider.listDirectory(path);
    this.listings.set(path, entries);
    void this.store.putListing({ workspaceId: this.id, path, entries, fetchedAt: Date.now() });
    return entries;
  }

  // ------------------------------------------------------------------ files

  /**
   * The file at `path`, fetching it only if this device has never had it.
   *
   * An already-open file comes back with its edits intact, which is the whole
   * reason the workspace sits in front of the provider: what the repository
   * says and what the user has written are different things, and the second
   * one wins.
   */
  async openFile(path: string): Promise<WorkspaceFile> {
    const held = this.files.get(path);
    if (held) {
      await this.setActive(path);
      return held;
    }

    const stored = await this.store.getFile(this.id, path);
    if (stored) {
      this.files.set(path, stored);
      await this.setActive(path);
      return stored;
    }

    const content = await this.provider.readFile(path);
    const file: WorkspaceFile = { path, original: content, content, updatedAt: Date.now() };
    this.files.set(path, file);
    await this.store.putFile(this.id, file);
    await this.setActive(path);
    return file;
  }

  /** Put a file into the workspace directly — a new local document, or an import. */
  async addFile(path: string, content: string, original = ''): Promise<WorkspaceFile> {
    const file: WorkspaceFile = { path, original, content, updatedAt: Date.now() };
    this.files.set(path, file);
    await this.store.putFile(this.id, file);
    await this.setActive(path);
    return file;
  }

  /**
   * Record an edit, and schedule the write that makes it survive the tab.
   *
   * Debounced rather than written per keystroke: a write per character would
   * put IndexedDB on the typing path for nothing, since the only thing that
   * matters is that a pause of a second or so is already safe.
   */
  setContent(path: string, content: string): void {
    const file = this.files.get(path);
    if (!file || file.content === content) return;
    file.content = content;
    file.updatedAt = Date.now();

    const pending = this.saveTimers.get(path);
    if (pending !== undefined) clearTimeout(pending);
    this.saveTimers.set(
      path,
      window.setTimeout(() => {
        this.saveTimers.delete(path);
        void this.store.putFile(this.id, file);
      }, AUTOSAVE_MS),
    );
  }

  /** Write everything pending immediately — for `pagehide`, which has no second chance. */
  flush(): void {
    for (const timer of this.saveTimers.values()) clearTimeout(timer);
    this.saveTimers.clear();
    for (const file of this.files.values()) void this.store.putFile(this.id, file);
    void this.persistMeta();
  }

  file(path: string): WorkspaceFile | undefined {
    return this.files.get(path);
  }

  statusOf(path: string): FileStatus | undefined {
    const file = this.files.get(path);
    return file ? statusOf(file) : undefined;
  }

  /** Everything the user has changed, which is what a commit would carry. */
  changedFiles(): WorkspaceFile[] {
    return [...this.files.values()].filter((file) => statusOf(file) !== 'unchanged');
  }

  get active(): string | null {
    return this.activePath;
  }

  private async setActive(path: string | null): Promise<void> {
    if (this.activePath === path) return;
    this.activePath = path;
    await this.persistMeta();
  }

  private async persistMeta(): Promise<void> {
    await this.store.putWorkspace({
      id: this.id,
      repository: this.repository,
      activePath: this.activePath,
      openedAt: this.openedAt,
      updatedAt: Date.now(),
    });
  }
}
