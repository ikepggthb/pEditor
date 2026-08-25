import {
  type FileEntry,
  type RepositorySummary,
  RepositoryError,
  parseRepositoryUrl,
  parentPath,
} from '../repo/index.ts';
import type { Workspace } from '../workspace/workspace.ts';
import type { WorkspaceMeta } from '../workspace/types.ts';
import { h } from './dom.ts';

/** Wait for typing to stop before searching: ten anonymous searches a minute. */
const SEARCH_DEBOUNCE_MS = 450;
/** One or two letters match everything and cost a request to prove it. */
const MIN_QUERY = 2;

export interface FilePanelOptions {
  /** Open a repository from a pasted URL. Rejections are shown in the panel. */
  onOpenRepository: (url: string) => Promise<void>;
  onOpenFile: (path: string) => Promise<void>;
  /** Repositories opened before, newest first, for the shortcut list. */
  recent: () => Promise<WorkspaceMeta[]>;
  /** Reopen one of them without going through a URL. */
  onOpenRecent: (meta: WorkspaceMeta) => Promise<void>;
  /** Find repositories by name. */
  search: (query: string, signal: AbortSignal) => Promise<RepositorySummary[]>;
  /** Called whenever the panel opens or closes, so the shell can react. */
  onVisibilityChange?: () => void;
}

type Tab = 'browse' | 'open';

/**
 * The file browser, and the way in to a repository.
 *
 * Two screens rather than one list, and that separation is the point. Files and
 * repositories are different kinds of thing that happen to look alike in a row
 * — a name, an icon, a chevron — so a list holding both is a list you have to
 * read carefully to use. Browse shows one directory of the open repository;
 * Open shows repositories, whether searched for or opened before. Neither ever
 * shows the other's rows.
 *
 * Browse is one directory at a time rather than an indented tree. A phone
 * screen is forty characters wide, and a nested tree spends most of them on
 * indentation for paths already ten levels deep — `src/librustdoc/html/render`
 * costs nothing here and half the screen there. Down is a tap on a directory,
 * up is a tap on the breadcrumb, and where you are is spelled out at the top.
 */
export class FilePanel {
  readonly element: HTMLDivElement;

  private readonly options: FilePanelOptions;
  private workspace: Workspace | null = null;
  private path = '';
  private tab: Tab = 'open';

  private searchField: HTMLInputElement;
  private tabs: HTMLDivElement;
  private crumbs: HTMLDivElement;
  private searchRow: HTMLDivElement;
  private list: HTMLDivElement;
  private status: HTMLDivElement;
  private title: HTMLDivElement;

  /** Guards against a slow listing landing after the user has moved on. */
  private generation = 0;
  private searchTimer: number | null = null;
  private searchRun: AbortController | null = null;

  constructor(options: FilePanelOptions) {
    this.options = options;

    this.searchField = h('input', {
      class: 'files-url',
      type: 'search',
      // Not `type=url`: most of what goes in here is words, and a URL keyboard
      // puts `/` and `.com` where the letters should be.
      autocapitalize: 'off',
      autocomplete: 'off',
      spellcheck: 'false',
      enterkeyhint: 'go',
      placeholder: 'Search, or paste a GitHub URL',
      'aria-label': 'Search repositories, or paste a GitHub URL',
    }) as HTMLInputElement;

    this.searchField.addEventListener('input', () => this.queueSearch());
    this.searchField.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Enter') return;
      const value = this.searchField.value.trim();
      if (parseRepositoryUrl(value)) void this.withStatus('Opening…', () => this.openRepository(value));
      else this.queueSearch(0);
    });

    this.title = h('div', { class: 'files-title', text: 'Files' }) as HTMLDivElement;
    // The panel covers the screen, so the button that opened it is behind it.
    // Without a way out of its own, the only exits are opening a file or the
    // system back gesture — and one of those is not on every phone.
    const closeButton = h('button', { type: 'button', class: 'files-close', title: 'Close', text: '×' });
    closeButton.addEventListener('click', () => this.hide());

    this.tabs = h('div', { class: 'files-tabs', role: 'tablist' }, [
      this.tabButton('browse', 'Files'),
      this.tabButton('open', 'Repositories'),
    ]) as HTMLDivElement;

    this.crumbs = h('div', { class: 'files-crumbs' }) as HTMLDivElement;
    this.searchRow = h('div', { class: 'files-open-row' }, [this.searchField]) as HTMLDivElement;
    this.list = h('div', { class: 'files-list' }) as HTMLDivElement;
    this.status = h('div', { class: 'files-status' }) as HTMLDivElement;

    this.element = h('div', { class: 'files', hidden: true }, [
      h('div', { class: 'files-head' }, [
        h('div', { class: 'files-grip' }),
        h('div', { class: 'files-title-row' }, [this.title, closeButton]),
        this.tabs,
        this.searchRow,
        this.crumbs,
      ]),
      this.status,
      this.list,
    ]) as HTMLDivElement;
  }

  private tabButton(tab: Tab, label: string): HTMLElement {
    const node = h('button', { type: 'button', class: 'files-tab', 'data-tab': tab, text: label });
    node.addEventListener('click', () => this.setTab(tab));
    return node;
  }

  get isOpen(): boolean {
    return !this.element.hasAttribute('hidden');
  }

  show(): void {
    if (this.isOpen) return;
    this.element.removeAttribute('hidden');
    requestAnimationFrame(() => this.element.classList.add('files-visible'));
    // Land on the files of whatever is open; with nothing open there is nothing
    // to browse, so the way in is the only thing worth showing.
    this.setTab(this.canBrowse ? 'browse' : 'open');
    this.options.onVisibilityChange?.();
  }

  hide(): void {
    if (!this.isOpen) return;
    this.cancelSearch();
    this.element.classList.remove('files-visible');
    this.element.setAttribute('hidden', '');
    this.options.onVisibilityChange?.();
  }

  /** Whether there is a repository whose files could be listed. */
  private get canBrowse(): boolean {
    return Boolean(this.workspace) && this.workspace?.repository.provider !== 'local';
  }

  private setTab(tab: Tab): void {
    this.tab = this.canBrowse ? tab : 'open';
    this.tabs.hidden = !this.canBrowse;
    for (const node of this.tabs.querySelectorAll('.files-tab')) {
      node.classList.toggle('is-active', (node as HTMLElement).dataset.tab === this.tab);
    }
    this.crumbs.hidden = this.tab !== 'browse';
    this.searchRow.hidden = this.tab !== 'open';

    if (this.tab === 'browse') void this.render();
    else void this.renderRepositories();
  }

  /** Point the panel at a workspace, starting in `path`'s directory. */
  setWorkspace(workspace: Workspace, path = ''): void {
    this.workspace = workspace;
    this.path = path;
    this.title.textContent = workspace.repository.name;
    // Opening a repository is done to look inside it, so that is where it goes.
    if (this.isOpen) this.setTab(this.canBrowse ? 'browse' : 'open');
  }

  /** Repaint the current directory, e.g. after a file became modified. */
  refresh(): void {
    if (this.isOpen && this.tab === 'browse') void this.render();
  }

  // ------------------------------------------------------------ repositories

  private cancelSearch(): void {
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.searchRun?.abort();
    this.searchRun = null;
  }

  private queueSearch(delay = SEARCH_DEBOUNCE_MS): void {
    this.cancelSearch();
    this.searchTimer = window.setTimeout(() => {
      this.searchTimer = null;
      void this.renderRepositories();
    }, delay);
  }

  /**
   * The Open screen: what was typed, or what has been opened before.
   *
   * Only ever one of the two. Search results and recent repositories are both
   * repositories, so showing them together would be the same confusion this
   * split exists to remove — an empty field means recents, anything else means
   * results.
   */
  private async renderRepositories(): Promise<void> {
    const mine = ++this.generation;
    const query = this.searchField.value.trim();

    // A pasted URL needs no request to act on, so it is offered immediately.
    const ref = query ? parseRepositoryUrl(query) : null;
    if (ref?.owner && ref.repo) {
      this.setStatus('');
      this.list.replaceChildren(
        h('div', { class: 'files-section', text: 'Open' }),
        this.repositoryRow(`${ref.owner}/${ref.repo}`, ref.branch ?? '', () =>
          this.openRepository(query),
        ),
      );
      return;
    }

    if (query.length >= MIN_QUERY) {
      this.setStatus('Searching…');
      const run = new AbortController();
      this.searchRun = run;
      let found: RepositorySummary[];
      try {
        found = await this.options.search(query, run.signal);
      } catch (error) {
        if (mine !== this.generation || (error as { name?: string }).name === 'AbortError') return;
        this.setStatus(describe(error), 'error');
        this.list.replaceChildren();
        return;
      }
      if (mine !== this.generation) return;

      this.setStatus(found.length ? '' : `Nothing on GitHub matches “${query}”.`);
      this.list.replaceChildren(
        ...(found.length ? [h('div', { class: 'files-section', text: 'Results' })] : []),
        ...found.map((summary) =>
          this.repositoryRow(summary.name, describeRepository(summary), () =>
            this.openRepository(`${summary.owner}/${summary.repo}`),
          ),
        ),
      );
      this.list.scrollTop = 0;
      return;
    }

    let entries: WorkspaceMeta[] = [];
    try {
      entries = await this.options.recent();
    } catch {
      entries = [];
    }
    if (mine !== this.generation) return;

    // The shortcut list leaves out whichever repository is open — it is one tab
    // away, and offering to reopen it is a row that does nothing.
    const repositories = entries.filter(
      (meta) => meta.repository.provider !== 'local' && meta.id !== this.workspace?.id,
    );
    this.setStatus(
      repositories.length ? '' : 'Search for a repository, or paste a GitHub URL.',
    );
    this.list.replaceChildren(
      ...(repositories.length ? [h('div', { class: 'files-section', text: 'Recent' })] : []),
      ...repositories.slice(0, 8).map((meta) => {
        const row = this.repositoryRow(meta.repository.name, meta.repository.branch ?? '', () =>
          this.options.onOpenRecent(meta),
        );
        row.classList.add('files-recent-row');
        return row;
      }),
    );
    this.list.scrollTop = 0;
  }

  /** A repository, which is a different shape of row from a file on purpose. */
  private repositoryRow(name: string, note: string, open: () => Promise<void>): HTMLElement {
    const row = h('button', { type: 'button', class: 'files-row files-repo-row' }, [
      h('span', { class: 'files-glyph files-glyph-repo' }),
      h('div', { class: 'files-stack' }, [
        h('div', { class: 'files-name', text: name }),
        ...(note ? [h('div', { class: 'files-note', text: note })] : []),
      ]),
      h('span', { class: 'files-chevron', text: '›' }),
    ]);
    row.addEventListener('click', () => void this.withStatus('Opening…', open));
    return row;
  }

  /**
   * Run something that can fail, and let the status line say which it was.
   *
   * One owner for the message. When the action reported its own failure *and*
   * resolved, the caller's success path wiped the error a moment later and the
   * panel sat there saying nothing at all.
   */
  private async withStatus(pending: string, action: () => Promise<void>): Promise<void> {
    this.setStatus(pending);
    try {
      await action();
      this.setStatus('');
    } catch (error) {
      this.setStatus(describe(error), 'error');
    }
  }

  private async openRepository(value: string): Promise<void> {
    this.cancelSearch();
    await this.options.onOpenRepository(value);
    this.searchField.value = '';
  }

  // ------------------------------------------------------------------- files

  private async render(): Promise<void> {
    const workspace = this.workspace;
    if (!workspace || !this.canBrowse) return;
    const mine = ++this.generation;

    this.renderCrumbs();
    this.setStatus('Loading…');
    let entries: FileEntry[];
    try {
      entries = await workspace.list(this.path);
    } catch (error) {
      if (mine !== this.generation) return;
      this.setStatus(describe(error), 'error');
      return;
    }
    if (mine !== this.generation) return;

    this.setStatus(entries.length ? '' : 'This directory is empty.');
    this.list.replaceChildren(...entries.map((entry) => this.row(entry)));
    this.list.scrollTop = 0;
  }

  private row(entry: FileEntry): HTMLElement {
    const status = this.workspace?.statusOf(entry.path);
    const directory = entry.type === 'directory';

    // Three signals, not one. A folder gets a filled glyph in the accent
    // colour, a heavier name, and a chevron saying the row goes somewhere; a
    // file gets an outlined glyph, its size, and no chevron. One of those alone
    // is a difference you have to look for.
    const node = h('button', { type: 'button', class: `files-row files-${entry.type}` }, [
      // Drawn in CSS rather than set as a character: a glyph that the device
      // happens not to have is a tofu box, and file icons are exactly the sort
      // of symbol whose coverage varies by platform.
      h('span', { class: `files-glyph ${directory ? 'files-glyph-dir' : 'files-glyph-file'}` }),
      h('span', { class: 'files-name', text: entry.name }),
    ]);
    if (status && status !== 'unchanged') {
      // The same single letter git uses, for the same reason: it survives being
      // squeezed against the right edge of a phone screen.
      node.appendChild(h('span', { class: 'files-badge', text: 'M', title: 'Modified' }));
    } else if (!directory && entry.size !== undefined) {
      node.appendChild(h('span', { class: 'files-meta', text: formatSize(entry.size) }));
    }
    if (directory) node.appendChild(h('span', { class: 'files-chevron', text: '›' }));

    node.addEventListener('click', () => {
      if (entry.type === 'directory') {
        this.path = entry.path;
        void this.render();
        return;
      }
      void this.open(entry.path);
    });
    return node;
  }

  private async open(path: string): Promise<void> {
    await this.withStatus('Opening…', async () => {
      await this.options.onOpenFile(path);
      this.hide();
    });
  }

  private renderCrumbs(): void {
    const segments = this.path ? this.path.split('/') : [];
    const crumb = (label: string, target: string) => {
      const node = h('button', { type: 'button', class: 'files-crumb', text: label });
      node.addEventListener('click', () => {
        this.path = target;
        void this.render();
      });
      return node;
    };

    const nodes: HTMLElement[] = [crumb(this.workspace?.repository.name ?? '/', '')];
    let walked = '';
    for (const segment of segments) {
      walked = walked ? `${walked}/${segment}` : segment;
      nodes.push(h('span', { class: 'files-sep', text: '/' }), crumb(segment, walked));
    }
    // The last crumb is where we are, so it is a label rather than a target.
    nodes[nodes.length - 1].classList.add('files-crumb-current');
    this.crumbs.replaceChildren(...nodes);
    this.crumbs.scrollLeft = this.crumbs.scrollWidth;
  }

  /**
   * Go up one level. Returns false when there is nowhere further up, so the
   * caller can close the panel instead.
   */
  goUp(): boolean {
    if (this.tab !== 'browse' || !this.path) return false;
    this.path = parentPath(this.path);
    void this.render();
    return true;
  }

  private setStatus(message: string, kind: 'error' | 'info' = 'info'): void {
    this.status.textContent = message;
    this.status.classList.toggle('files-status-error', kind === 'error' && Boolean(message));
    this.status.hidden = !message;
  }
}

function describeRepository(summary: RepositorySummary): string {
  const parts: string[] = [];
  if (summary.stars !== undefined) parts.push(`★ ${formatCount(summary.stars)}`);
  if (summary.language) parts.push(summary.language);
  if (summary.description) parts.push(summary.description);
  return parts.join(' · ');
}

function describe(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  return 'Something went wrong.';
}

function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1000000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}k`;
  return `${(value / 1000000).toFixed(1)}M`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
