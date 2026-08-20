import { type FileEntry, RepositoryError, parseRepositoryUrl, parentPath } from '../repo/index.ts';
import type { Workspace } from '../workspace/workspace.ts';
import { h } from './dom.ts';

export interface FilePanelOptions {
  /** Open a repository from a pasted URL. Rejections are shown in the panel. */
  onOpenRepository: (url: string) => Promise<void>;
  onOpenFile: (path: string) => Promise<void>;
  /** Called whenever the panel opens or closes, so the shell can react. */
  onVisibilityChange?: () => void;
}

/**
 * The file browser.
 *
 * One directory at a time rather than an indented tree. A phone screen is
 * forty characters wide, and a nested tree spends most of them on indentation
 * for paths that are already ten levels deep — `src/librustdoc/html/render`
 * costs nothing here and half the screen there. Going down is a tap on a
 * directory, going up is a tap on the breadcrumb, and the current position is
 * always spelled out at the top.
 */
export class FilePanel {
  readonly element: HTMLDivElement;

  private readonly options: FilePanelOptions;
  private workspace: Workspace | null = null;
  private path = '';
  private urlField: HTMLInputElement;
  private crumbs: HTMLDivElement;
  private list: HTMLDivElement;
  private status: HTMLDivElement;
  private title: HTMLDivElement;
  /** Guards against a slow listing landing after the user has moved on. */
  private generation = 0;

  constructor(options: FilePanelOptions) {
    this.options = options;

    this.urlField = h('input', {
      class: 'files-url',
      type: 'url',
      inputmode: 'url',
      autocapitalize: 'off',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'github.com/owner/repo',
      'aria-label': 'GitHub repository URL',
    }) as HTMLInputElement;

    const openButton = h('button', { type: 'button', class: 'files-open', text: 'Open' });
    openButton.addEventListener('click', () => void this.openRepository());
    this.urlField.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') void this.openRepository();
    });

    this.title = h('div', { class: 'files-title', text: 'Files' }) as HTMLDivElement;
    // The panel covers the screen, so the button that opened it is behind it.
    // Without a way out of its own, the only exits are opening a file or the
    // system back gesture — and one of those is not on every phone.
    const closeButton = h('button', { type: 'button', class: 'files-close', title: 'Close', text: '×' });
    closeButton.addEventListener('click', () => this.hide());
    this.crumbs = h('div', { class: 'files-crumbs' }) as HTMLDivElement;
    this.list = h('div', { class: 'files-list' }) as HTMLDivElement;
    this.status = h('div', { class: 'files-status' }) as HTMLDivElement;

    this.element = h('div', { class: 'files', hidden: true }, [
      h('div', { class: 'files-head' }, [
        h('div', { class: 'files-grip' }),
        h('div', { class: 'files-title-row' }, [this.title, closeButton]),
        h('div', { class: 'files-open-row' }, [this.urlField, openButton]),
        this.crumbs,
      ]),
      this.status,
      this.list,
    ]) as HTMLDivElement;
  }

  get isOpen(): boolean {
    return !this.element.hasAttribute('hidden');
  }

  show(): void {
    if (this.isOpen) return;
    this.element.removeAttribute('hidden');
    requestAnimationFrame(() => this.element.classList.add('files-visible'));
    if (this.workspace) void this.render();
    this.options.onVisibilityChange?.();
  }

  hide(): void {
    if (!this.isOpen) return;
    this.element.classList.remove('files-visible');
    this.element.setAttribute('hidden', '');
    this.options.onVisibilityChange?.();
  }

  /** Point the panel at a workspace, starting in `path`'s directory. */
  setWorkspace(workspace: Workspace, path = ''): void {
    this.workspace = workspace;
    this.path = path;
    this.title.textContent = workspace.repository.name;
    if (this.isOpen) void this.render();
  }

  /** Repaint the current directory, e.g. after a file became modified. */
  refresh(): void {
    if (this.isOpen && this.workspace) void this.render();
  }

  private async openRepository(): Promise<void> {
    const value = this.urlField.value.trim();
    if (!value) return;
    if (!parseRepositoryUrl(value)) {
      this.setStatus('That does not look like a GitHub repository URL.', 'error');
      return;
    }
    this.setStatus('Opening…');
    try {
      await this.options.onOpenRepository(value);
      this.urlField.value = '';
      this.setStatus('');
    } catch (error) {
      this.setStatus(describe(error), 'error');
    }
  }

  private async render(): Promise<void> {
    const workspace = this.workspace;
    if (!workspace) return;
    const mine = ++this.generation;

    this.renderCrumbs();
    if (workspace.repository.provider === 'local') {
      this.list.replaceChildren();
      this.setStatus('Open a GitHub repository above to browse its files.');
      return;
    }

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
    const node = h('button', { type: 'button', class: `files-row files-${entry.type}` }, [
      h('span', { class: 'files-icon', text: entry.type === 'directory' ? '/' : '' }),
      h('span', { class: 'files-name', text: entry.name }),
    ]);
    if (status && status !== 'unchanged') {
      // The same single letter git uses, for the same reason: it survives being
      // squeezed against the right edge of a phone screen.
      node.appendChild(h('span', { class: 'files-badge', text: 'M', title: 'Modified' }));
    } else if (entry.type === 'file' && entry.size !== undefined) {
      node.appendChild(h('span', { class: 'files-size', text: formatSize(entry.size) }));
    }

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
    this.setStatus('Opening…');
    try {
      await this.options.onOpenFile(path);
      this.setStatus('');
      this.hide();
    } catch (error) {
      this.setStatus(describe(error), 'error');
    }
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

  /** Go up one directory. Returns false at the root, so a caller can close. */
  goUp(): boolean {
    if (!this.path) return false;
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

function describe(error: unknown): string {
  if (error instanceof RepositoryError) return error.message;
  return 'Something went wrong.';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
