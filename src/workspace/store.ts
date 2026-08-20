import type { CachedListing, WorkspaceFile, WorkspaceMeta } from './types.ts';

const DB_NAME = 'peditor';
const DB_VERSION = 1;
const WORKSPACES = 'workspaces';
const FILES = 'files';
const LISTINGS = 'listings';

/** Which workspace to restore on the next launch. Small, so localStorage. */
const LAST_KEY = 'peditor.workspace.v1';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Where edited files live between sessions.
 *
 * IndexedDB rather than localStorage, and not only for the size: this is not a
 * cache of what GitHub already has, it is the only copy of work the user has
 * done. A tab discarded by the OS, a browser closed, a phone that ran out of
 * memory — none of those may lose an edit, and none of them give any warning.
 * So writes happen as the text changes, not when something is "saved".
 *
 * Every method degrades to a no-op if the database cannot be opened (private
 * browsing, storage disabled). Losing persistence is bad; refusing to open a
 * file because of it would be worse.
 */
export class WorkspaceStore {
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase | null> | null = null;

  private open(): Promise<IDBDatabase | null> {
    if (this.db) return Promise.resolve(this.db);
    if (this.opening) return this.opening;

    this.opening = new Promise<IDBDatabase | null>((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(WORKSPACES)) db.createObjectStore(WORKSPACES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(FILES)) {
          db.createObjectStore(FILES, { keyPath: ['workspaceId', 'path'] });
        }
        if (!db.objectStoreNames.contains(LISTINGS)) {
          db.createObjectStore(LISTINGS, { keyPath: ['workspaceId', 'path'] });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this.opening;
  }

  private async run<T>(
    store: string,
    mode: IDBTransactionMode,
    body: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | null> {
    const db = await this.open();
    if (!db) return null;
    try {
      const transaction = db.transaction(store, mode);
      return await promisify(body(transaction.objectStore(store)));
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------- workspaces

  async putWorkspace(meta: WorkspaceMeta): Promise<void> {
    await this.run(WORKSPACES, 'readwrite', (store) => store.put(meta));
  }

  async getWorkspace(id: string): Promise<WorkspaceMeta | null> {
    return (await this.run<WorkspaceMeta | undefined>(WORKSPACES, 'readonly', (store) => store.get(id))) ?? null;
  }

  async listWorkspaces(): Promise<WorkspaceMeta[]> {
    const all = await this.run<WorkspaceMeta[]>(WORKSPACES, 'readonly', (store) => store.getAll());
    return (all ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // ------------------------------------------------------------------ files

  async putFile(workspaceId: string, file: WorkspaceFile): Promise<void> {
    await this.run(FILES, 'readwrite', (store) => store.put({ workspaceId, ...file }));
  }

  async getFile(workspaceId: string, path: string): Promise<WorkspaceFile | null> {
    const record = await this.run<(WorkspaceFile & { workspaceId: string }) | undefined>(
      FILES,
      'readonly',
      (store) => store.get([workspaceId, path]),
    );
    if (!record) return null;
    const { workspaceId: _ignored, ...file } = record;
    return file;
  }

  /** Every file this workspace has open, for restoring the modified markers. */
  async getFiles(workspaceId: string): Promise<WorkspaceFile[]> {
    const all = await this.run<(WorkspaceFile & { workspaceId: string })[]>(FILES, 'readonly', (store) =>
      store.getAll(IDBKeyRange.bound([workspaceId, ''], [workspaceId, '￿'])),
    );
    return (all ?? []).map(({ workspaceId: _ignored, ...file }) => file);
  }

  async deleteFile(workspaceId: string, path: string): Promise<void> {
    await this.run(FILES, 'readwrite', (store) => store.delete([workspaceId, path]));
  }

  // --------------------------------------------------------------- listings

  async putListing(listing: CachedListing): Promise<void> {
    await this.run(LISTINGS, 'readwrite', (store) => store.put(listing));
  }

  async getListing(workspaceId: string, path: string): Promise<CachedListing | null> {
    return (
      (await this.run<CachedListing | undefined>(LISTINGS, 'readonly', (store) =>
        store.get([workspaceId, path]),
      )) ?? null
    );
  }

  // ------------------------------------------------------------ last opened

  rememberLast(id: string): void {
    try {
      localStorage.setItem(LAST_KEY, id);
    } catch {
      /* Storage disabled; the next launch starts fresh, which is survivable. */
    }
  }

  lastOpened(): string | null {
    try {
      return localStorage.getItem(LAST_KEY);
    } catch {
      return null;
    }
  }
}
