import { Editor, DEFAULT_CONFIG, type EditorConfig } from '../editor/core/editor.ts';
import { TextInput, type InputMode } from '../editor/input/textInput.ts';
import { SelectionHandles } from '../editor/input/handles.ts';
import { PointerInput } from '../editor/input/pointer.ts';
import { PinchZoom } from '../editor/input/pinch.ts';
import { LANGUAGES, languageForFilename } from '../editor/syntax/highlighter.ts';
import { columnAt } from '../editor/view/columns.ts';
import { KeyBar } from './keybar.ts';
import { CodeKeyboard } from './keyboard/keyboard.ts';
import { SelectionMenu } from './selectionMenu.ts';
import { FrameMeter } from './frameMeter.ts';
import { FilePanel } from './files.ts';
import { h, segmentRow, selectRow, toggleRow } from './dom.ts';
import { debounce, loadDocument, loadSettings, saveSettings, throttle } from './storage.ts';
import { lockDocumentScroll, trackVisualViewport } from './viewport.ts';
import { SAMPLE_FILENAME, SAMPLE_TEXT } from './sample.ts';
import { baseName, parentPath, parseRepositoryUrl, RepositoryError } from '../repo/index.ts';
import { Workspace } from '../workspace/workspace.ts';
import { WorkspaceStore } from '../workspace/store.ts';

type Theme = 'auto' | 'dark' | 'light';
/** Reading or writing. Reading is what this is mostly for. */
type Mode = 'view' | 'edit';
const THEME_KEY = 'peditor.theme.v1';
const MODE_KEY = 'peditor.mode.v1';
const KEYBOARD_KEY = 'peditor.keyboard.v1';
const KEYBOARD_HEIGHT_KEY = 'peditor.keyboardHeight.v1';
const FRAME_RATE_KEY = 'peditor.frameRate.v1';

/** The application shell: chrome around the editor, plus what persists. */
export class App {
  private editor: Editor;
  private input: TextInput;
  private handles: SelectionHandles;
  private pointer: PointerInput;
  private pinch: PinchZoom;
  private keybar: KeyBar;
  private keyboard: CodeKeyboard;
  private menu: SelectionMenu;
  private files: FilePanel;

  private root: HTMLDivElement;
  private nameField: HTMLInputElement;
  private statusPosition: HTMLElement;
  private statusLanguage: HTMLElement;
  private statusSize: HTMLElement;
  private statusFrames: HTMLElement;
  private sheet: HTMLDivElement;
  private undoButton: HTMLButtonElement;
  private redoButton: HTMLButtonElement;
  private modeButton: HTMLButtonElement;
  private dirtyMark: HTMLElement;
  private editOnlyRows: HTMLElement[] = [];

  /** Where opened files and edits live; see workspace/workspace.ts. */
  private store = new WorkspaceStore();
  private workspace: Workspace | null = null;
  /** Path of the file on screen, within the workspace. */
  private activePath: string | null = null;

  private fileName: string;
  private theme: Theme = (localStorage.getItem(THEME_KEY) as Theme) ?? 'auto';
  /** Which keyboard the editor uses. The code keyboard is the default; the
   *  platform one is a tap away and is the only one that can run an IME. */
  private keyboardMode: InputMode = (localStorage.getItem(KEYBOARD_KEY) as InputMode) ?? 'custom';
  /** Viewing by default: this is a reader that can also edit, not the reverse. */
  private mode: Mode = (localStorage.getItem(MODE_KEY) as Mode) ?? 'view';
  /** Frame timing readout, off unless asked for — see ui/frameMeter.ts. */
  private frameMeter = new FrameMeter();
  private showFrameRate = localStorage.getItem(FRAME_RATE_KEY) === '1';
  /** Whether a history entry is parked for the back button to consume. */
  private backGuard = false;

  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    const saved = loadDocument();
    const settings = loadSettings() ?? {};

    // The document arrives from IndexedDB a moment after mount, so the editor
    // starts empty rather than showing something that is about to be replaced.
    // `saved` is only consulted to migrate a document written by the version
    // that kept one in localStorage.
    void saved;
    this.fileName = SAMPLE_FILENAME;
    this.editor = new Editor('', { ...DEFAULT_CONFIG, ...settings });
    this.input = new TextInput(this.editor);
    this.handles = new SelectionHandles(this.editor, () => this.input.syncPosition());
    this.pointer = new PointerInput(this.editor, this.input, this.handles);
    this.pinch = new PinchZoom(this.editor);
    this.keybar = new KeyBar(this.editor, this.input, () => this.setKeyboardMode('custom'));
    this.keyboard = new CodeKeyboard(this.editor, {
      onSystemKeyboard: () => this.setKeyboardMode('system'),
      onHeightChange: (height) => localStorage.setItem(KEYBOARD_HEIGHT_KEY, String(height)),
      initialHeight: Number(localStorage.getItem(KEYBOARD_HEIGHT_KEY)) || undefined,
    });
    this.menu = new SelectionMenu(this.editor, {
      onDone: () => this.input.focus(),
      isBusy: () => this.handles.isDragging,
    });
    this.files = new FilePanel({
      onOpenRepository: (url) => this.openRepository(url),
      onOpenFile: (path) => this.showFile(path),
      onVisibilityChange: () => this.syncBackGuard(),
    });

    this.nameField = h('input', {
      class: 'topbar-name',
      value: this.fileName,
      spellcheck: 'false',
      'aria-label': 'File name',
    }) as HTMLInputElement;

    this.undoButton = h('button', { type: 'button', class: 'icon-btn', title: 'Undo', text: '↶' }) as HTMLButtonElement;
    this.redoButton = h('button', { type: 'button', class: 'icon-btn', title: 'Redo', text: '↷' }) as HTMLButtonElement;
    this.modeButton = h('button', { type: 'button', class: 'mode-btn' }) as HTMLButtonElement;

    this.dirtyMark = h('span', { class: 'topbar-dirty', title: 'Unsaved changes', text: '●', hidden: true });
    this.statusPosition = h('span', { class: 'status-item', text: 'Ln 1, Col 1' });
    this.statusLanguage = h('span', { class: 'status-item status-language' });
    this.statusSize = h('span', { class: 'status-item status-size' });
    this.statusFrames = h('span', { class: 'status-item status-frames', hidden: true });

    this.sheet = h('div', { class: 'sheet', hidden: true }) as HTMLDivElement;
    this.root = h('div', { class: 'app' }) as HTMLDivElement;
  }

  mount(): void {
    const filesButton = h('button', { type: 'button', class: 'icon-btn', title: 'Files', text: '☰' });
    const menuButton = h('button', { type: 'button', class: 'icon-btn', title: 'Settings', text: '⋯' });
    const keyboardButton = h('button', { type: 'button', class: 'icon-btn', title: 'Hide keyboard', text: '⌄' });

    const topbar = h('header', { class: 'topbar' }, [
      filesButton,
      this.nameField,
      this.dirtyMark,
      this.undoButton,
      this.redoButton,
      this.modeButton,
      menuButton,
    ]);

    const editorHost = h('div', { class: 'editor-host' });
    const statusbar = h('footer', { class: 'statusbar' }, [
      this.statusPosition,
      h('span', { class: 'status-spacer' }),
      this.statusFrames,
      this.statusLanguage,
      this.statusSize,
      keyboardButton,
    ]);

    this.root.append(
      topbar,
      editorHost,
      statusbar,
      this.keybar.element,
      this.keyboard.element,
      this.files.element,
      this.sheet,
    );
    this.host.appendChild(this.root);

    this.editor.mount(editorHost);
    this.input.attach();
    this.handles.attach();
    this.pointer.attach();
    this.pinch.attach();
    this.menu.attach();
    this.input.setMode(this.keyboardMode);

    // A tap is what asks for the bubble, and the end of a handle drag is what
    // brings it back — nothing the editor emits marks either, so the gesture's
    // own end does. By the time this bubbles up from a handle, the drag has
    // already cleared itself.
    for (const type of ['pointerup', 'pointercancel'] as const) {
      editorHost.addEventListener(type, () => this.menu.reveal());
    }

    this.applyTheme();
    this.editor.setLanguage(languageForFilename(this.fileName).id);
    this.buildSheet();
    this.applyMode();

    menuButton.addEventListener('click', () => this.openSheet());
    filesButton.addEventListener('click', () => this.toggleFiles());
    this.modeButton.addEventListener('click', () => {
      this.setMode(this.mode === 'view' ? 'edit' : 'view');
    });
    keyboardButton.addEventListener('click', () => this.input.blur());
    this.undoButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.editor.undo();
      this.input.focus();
    });
    this.redoButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.editor.redo();
      this.input.focus();
    });

    this.nameField.addEventListener('change', () => {
      void this.rename(this.nameField.value.trim() || 'untitled.txt');
    });
    this.nameField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.nameField.blur();
    });

    // `getValue()` walks the whole buffer, so it is not something to do per
    // keystroke; the workspace then debounces the write to IndexedDB again.
    const sync = debounce(() => this.syncToWorkspace(), 400);
    this.editor.on('change', () => {
      this.updateStatus();
      this.updateSize();
      sync();
    });
    this.editor.on('selection', () => this.updateStatus());
    this.editor.on('focus', () => this.syncKeyboards());
    this.editor.on('config', () => {
      this.updateStatus();
      saveSettings(this.editor.config);
    });

    window.addEventListener('popstate', () => this.onPopState());

    // The browser may kill the tab without warning; take a last snapshot.
    window.addEventListener('pagehide', () => this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });

    lockDocumentScroll();
    trackVisualViewport(this.root);
    this.syncKeyboards();
    this.applyFrameRate();
    this.updateStatus();
    this.updateSize();
    void this.boot();
  }

  // -------------------------------------------------------------- workspace

  /**
   * Bring back whatever was being worked on.
   *
   * Restoring is the normal path, not the exception: a phone discards tabs
   * without asking, and the edits in a workspace exist nowhere else.
   */
  private async boot(): Promise<void> {
    let workspace: Workspace | null = null;
    try {
      workspace = await Workspace.restoreLast(this.store);
    } catch {
      workspace = null;
    }
    if (!workspace) {
      try {
        workspace = await Workspace.open({ provider: 'local' }, this.store);
      } catch {
        // No IndexedDB at all. The editor still works; nothing will persist.
        this.editor.setValue(SAMPLE_TEXT, SAMPLE_FILENAME);
        return;
      }
    }
    await this.adopt(workspace);
  }

  private async adopt(workspace: Workspace): Promise<void> {
    this.workspace = workspace;
    this.files.setWorkspace(workspace, workspace.active ? parentPath(workspace.active) : '');

    if (workspace.active) {
      try {
        await this.showFile(workspace.active);
        return;
      } catch {
        // The file has gone from the repository, or we are offline and never
        // had it. Fall through to an empty workspace rather than failing boot.
      }
    }
    if (workspace.repository.provider === 'local') await this.seedLocal(workspace);
    else this.files.show();
  }

  /**
   * First run, or a local workspace with nothing in it yet.
   *
   * A document written by the version that kept one in localStorage is carried
   * over here, once — losing someone's notes on an upgrade is not acceptable
   * just because the storage moved.
   */
  private async seedLocal(workspace: Workspace): Promise<void> {
    const legacy = loadDocument();
    const name = legacy?.name ?? SAMPLE_FILENAME;
    const text = legacy?.text ?? SAMPLE_TEXT;
    await workspace.addFile(name, text, legacy ? text : text);
    await this.showFile(name);
  }

  /** Open a GitHub repository and show its root. */
  private async openRepository(url: string): Promise<void> {
    const ref = parseRepositoryUrl(url);
    if (!ref) throw new RepositoryError('unsupported', 'That does not look like a GitHub repository URL.');
    const workspace = await Workspace.open(ref, this.store);
    this.workspace = workspace;
    this.files.setWorkspace(workspace, ref.path ? parentPath(ref.path) : '');
    if (ref.path) await this.showFile(ref.path);
  }

  /** Put a file from the workspace on screen. */
  private async showFile(path: string): Promise<void> {
    const workspace = this.workspace;
    if (!workspace) return;
    const file = await workspace.openFile(path);

    this.activePath = path;
    this.fileName = baseName(path);
    this.nameField.value = this.fileName;
    // A repository file is named by the repository; only a local scratch file
    // is something the user gets to rename here.
    this.nameField.readOnly = workspace.repository.provider !== 'local' || this.mode !== 'edit';

    this.editor.setValue(file.content, this.fileName);
    this.editor.renderer.scroller.scrollTop = 0;
    this.updateStatus();
    this.updateSize();
    this.files.refresh();
  }

  /**
   * Put a document into the on-device workspace and show it.
   *
   * Opening a file from the device or starting a new one is a different
   * repository from whatever GitHub project may be open, so it switches to the
   * local workspace rather than pretending the file belongs to the project.
   */
  private async openLocalFile(name: string, text: string): Promise<void> {
    const workspace = await Workspace.open({ provider: 'local' }, this.store);
    this.workspace = workspace;
    this.files.setWorkspace(workspace);
    await workspace.addFile(name, text, text);
    await this.showFile(name);
  }

  /** Rename a local scratch file. Repository files are named by the repository. */
  private async rename(name: string): Promise<void> {
    const workspace = this.workspace;
    if (!workspace || workspace.repository.provider !== 'local' || !this.activePath) {
      this.nameField.value = this.fileName;
      return;
    }
    if (name === this.activePath) return;
    await workspace.addFile(name, this.editor.getValue(), workspace.file(this.activePath)?.original ?? '');
    await this.showFile(name);
  }

  private syncToWorkspace(): void {
    if (!this.workspace || !this.activePath) return;
    this.workspace.setContent(this.activePath, this.editor.getValue());
    this.updateStatus();
    this.files.refresh();
  }

  private flush(): void {
    this.syncToWorkspace();
    this.workspace?.flush();
  }

  private toggleFiles(): void {
    if (this.files.isOpen) {
      this.files.hide();
    } else {
      this.closeSheet();
      this.files.show();
    }
    this.syncBackGuard();
  }

  /** Show or hide the frame-timing readout, and start/stop measuring. */
  private applyFrameRate(): void {
    this.statusFrames.hidden = !this.showFrameRate;
    if (!this.showFrameRate) {
      this.frameMeter.stop();
      this.statusFrames.textContent = '';
      return;
    }
    this.frameMeter.start(({ fps, worstMs }) => {
      this.statusFrames.textContent = `${fps}fps · ${worstMs}ms`;
    });
  }

  // ------------------------------------------------------------------- modes

  /**
   * Switch between reading and writing.
   *
   * Reading is the default and the point of the thing; editing is a mode you
   * step into. What that buys is mostly the absence of an editor: no keyboard
   * taking half the screen the moment a finger lands, no caret blinking in a
   * document nobody is typing into, and no way to change a file by accident
   * while scrolling through it.
   */
  private setMode(mode: Mode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    localStorage.setItem(MODE_KEY, mode);
    this.applyMode();
    // Editing is asked for by a tap, so the keyboard can be opened from inside
    // it — which is the only way iOS will ever open one.
    if (mode === 'edit') this.input.focus();
    else this.input.blur();
  }

  private applyMode(): void {
    const editing = this.mode === 'edit';
    this.editor.setReadOnly(!editing);
    this.root.classList.toggle('app-viewing', !editing);

    this.modeButton.textContent = editing ? 'Done' : 'Edit';
    this.modeButton.title = editing ? 'Finish editing' : 'Edit this file';
    this.modeButton.classList.toggle('mode-btn-active', editing);

    // Undo has nothing to undo while viewing, and renaming a file is an edit.
    this.undoButton.hidden = !editing;
    this.redoButton.hidden = !editing;
    this.nameField.readOnly = !editing || this.workspace?.repository.provider !== 'local';

    for (const row of this.editOnlyRows) row.hidden = !editing;

    this.syncKeyboards();
    this.updateStatus();
  }

  /** Show whichever keyboard is selected, and only while the editor is active. */
  private syncKeyboards(): void {
    const active = this.editor.isFocused && this.mode === 'edit';
    const custom = this.keyboardMode === 'custom';
    this.keybar.setVisible(active && !custom);
    this.keyboard.setVisible(active && custom);
    void active;
    this.syncBackGuard();
  }

  /**
   * Make Android's back gesture dismiss what is on top instead of leaving.
   *
   * The system button has no event of its own: the only thing a page can react
   * to is a history entry being popped. So whenever something is up that back
   * ought to close — a keyboard, the file browser — there is one extra entry on
   * the stack for it to consume, and when that thing closes any other way the
   * entry is spent so it cannot swallow a later back that really did mean
   * "leave".
   */
  private syncBackGuard(): void {
    const wanted = this.files.isOpen || (this.editor.isFocused && this.mode === 'edit');
    if (wanted === this.backGuard) return;
    this.backGuard = wanted;
    if (wanted) history.pushState({ pe: 'overlay' }, '');
    else history.back();
  }

  private onPopState(): void {
    // Our entry has already been popped, so clear the flag before closing —
    // otherwise the close would call `history.back()` and take the real one.
    if (!this.backGuard) return;
    this.backGuard = false;

    // Innermost first: inside the file browser, back walks up a directory
    // before it closes the browser, which is what the button means there.
    if (this.files.isOpen) {
      if (!this.files.goUp()) this.files.hide();
    } else {
      this.input.blur();
      this.syncKeyboards();
    }
    this.syncBackGuard();
  }

  private setKeyboardMode(mode: InputMode): void {
    if (this.keyboardMode === mode) return;
    this.keyboardMode = mode;
    localStorage.setItem(KEYBOARD_KEY, mode);
    // Runs inside the tap that requested it, which is what lets iOS open the
    // platform keyboard when switching back to it.
    this.input.setMode(mode);
    this.syncKeyboards();
  }



  /** Cheap enough to run on every keystroke and cursor move. */
  private updateStatus(): void {
    if (this.mode === 'edit') {
      const head = this.editor.selection.head;
      const column = columnAt(this.editor.buffer.line(head.line), head.ch, this.editor.config.tabSize) + 1;
      this.statusPosition.textContent = `Ln ${head.line + 1}, Col ${column}`;
    } else {
      // A caret position means nothing without a caret; the length of what you
      // are reading does.
      const lines = this.editor.buffer.lineCount;
      this.statusPosition.textContent = `${lines.toLocaleString()} ${lines === 1 ? 'line' : 'lines'}`;
    }
    this.statusLanguage.textContent = this.editor.language.name;
    const modified = this.activePath ? this.workspace?.statusOf(this.activePath) === 'modified' : false;
    this.dirtyMark.hidden = !modified;

    this.undoButton.disabled = !this.editor.history.canUndo;
    this.redoButton.disabled = !this.editor.history.canRedo;
  }

  /**
   * Document size, throttled: it walks the whole buffer, so on a large file it
   * is the single most expensive thing the UI does. Nobody needs a byte count
   * that updates per character.
   */
  private updateSize = throttle(() => {
    const bytes = this.editor.buffer.byteLength();
    this.statusSize.textContent = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  }, 600);

  // -------------------------------------------------------------- settings UI

  private openSheet(): void {
    if (!this.sheet.hasAttribute('hidden')) return;
    this.sheet.removeAttribute('hidden');
    this.sheet.scrollTop = 0;
    requestAnimationFrame(() => this.sheet.classList.add('sheet-open'));
  }

  private closeSheet(): void {
    if (this.sheet.hasAttribute('hidden')) return;
    this.sheet.classList.remove('sheet-open');
    this.sheet.style.removeProperty('--sheet-y');
    setTimeout(() => this.sheet.setAttribute('hidden', ''), 200);
  }

  /**
   * Drag the sheet's header downwards to dismiss it.
   *
   * Only the header is draggable: the body is a scrolling list, and a gesture
   * that both scrolls content and drags the container is the kind of thing that
   * ends up doing neither. Offset travels through a custom property because the
   * sheet's transform also carries its horizontal centering on wide screens.
   */
  private bindSheetDrag(grip: HTMLElement): void {
    let startY = 0;
    let offset = 0;
    let dragging = false;

    grip.addEventListener('pointerdown', (event) => {
      dragging = true;
      startY = event.clientY;
      offset = 0;
      grip.setPointerCapture(event.pointerId);
      this.sheet.style.transition = 'none';
    });

    grip.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      offset = Math.max(0, event.clientY - startY);
      this.sheet.style.setProperty('--sheet-y', `${offset}px`);
    });

    const end = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);
      this.sheet.style.removeProperty('transition');
      this.sheet.style.removeProperty('--sheet-y');
      // Far enough to read as intent rather than a slip.
      if (offset > 80) this.closeSheet();
    };

    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  private buildSheet(): void {
    const config = this.editor.config;
    const set = (patch: Partial<EditorConfig>) => this.editor.setConfig(patch);

    // A pinch leaves a fractional size behind, deliberately — see input/pinch.ts.
    // The stepper works in whole pixels regardless, and rounds off whatever the
    // gesture left rather than carrying the fraction along for ever.
    const fontValue = h('span', { class: 'stepper-value', text: `${Math.round(config.fontSize)}px` });
    const smaller = h('button', { type: 'button', class: 'stepper-btn', text: '−' });
    const larger = h('button', { type: 'button', class: 'stepper-btn', text: '+' });
    const stepFont = (delta: number) => {
      const size = Math.max(10, Math.min(28, Math.round(this.editor.config.fontSize) + delta));
      set({ fontSize: size });
      fontValue.textContent = `${size}px`;
    };
    smaller.addEventListener('click', () => stepFont(-1));
    larger.addEventListener('click', () => stepFont(1));

    const fileInput = h('input', { type: 'file', class: 'hidden-file' }) as HTMLInputElement;
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const text = await file.text();
      await this.openLocalFile(file.name, text);
      this.closeSheet();
    });

    const grip = h('div', { class: 'sheet-grip' }, [
      h('div', { class: 'sheet-handle' }),
      h('div', { class: 'sheet-title', text: 'Settings' }),
    ]);
    this.bindSheetDrag(grip);

    this.sheet.append(
      grip,

      selectRow(
        'Language',
        LANGUAGES.map((language) => ({ value: language.id, label: language.name })),
        this.editor.language.id,
        (value) => this.editor.setLanguage(value),
      ),
      segmentRow('Theme', [
        { value: 'auto', label: 'Auto' },
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
      ], this.theme, (value) => {
        this.theme = value as Theme;
        localStorage.setItem(THEME_KEY, value);
        this.applyTheme();
      }),
      h('div', { class: 'sheet-row' }, [
        h('span', { text: 'Font size' }),
        h('div', { class: 'stepper' }, [smaller, fontValue, larger]),
      ]),

      toggleRow('Word wrap', config.wordWrap, (value) => set({ wordWrap: value })),
      toggleRow('Line numbers', config.lineNumbers, (value) => set({ lineNumbers: value })),
      ...this.editOnly([
        segmentRow('Keyboard', [
          { value: 'custom', label: 'Code' },
          { value: 'system', label: 'System' },
        ], this.keyboardMode, (value) => this.setKeyboardMode(value as InputMode)),
        segmentRow('Tab size', [
          { value: '2', label: '2' },
          { value: '4', label: '4' },
          { value: '8', label: '8' },
        ], String(config.tabSize), (value) => set({ tabSize: Number(value) })),
        toggleRow('Insert spaces', config.insertSpaces, (value) => set({ insertSpaces: value })),
        toggleRow('Auto-close brackets', config.autoCloseBrackets, (value) => set({ autoCloseBrackets: value })),
        toggleRow('Auto indent', config.autoIndent, (value) => set({ autoIndent: value })),
      ]),
      toggleRow('Show frame rate', this.showFrameRate, (value) => {
        this.showFrameRate = value;
        localStorage.setItem(FRAME_RATE_KEY, value ? '1' : '0');
        this.applyFrameRate();
      }),

      h('div', { class: 'sheet-actions' }, [
        this.actionButton('Open file…', () => fileInput.click()),
        this.actionButton('Download', () => this.download()),
        this.actionButton('Copy all', () => void navigator.clipboard?.writeText(this.editor.getValue())),
        this.actionButton('New', () => {
          if (!confirm('Discard the current document?')) return;
          void this.openLocalFile('untitled.txt', '').then(() => this.closeSheet());
        }),
      ]),

      this.actionButton('Close', () => this.closeSheet(), 'sheet-close'),
      fileInput,
    );
  }

  /** Remember these rows so they can be hidden when there is no editing to do. */
  private editOnly(rows: HTMLElement[]): HTMLElement[] {
    this.editOnlyRows.push(...rows);
    return rows;
  }

  private actionButton(label: string, onClick: () => void, className = 'sheet-action'): HTMLElement {
    const button = h('button', { type: 'button', class: className, text: label });
    button.addEventListener('click', onClick);
    return button;
  }

  private download(): void {
    const blob = new Blob([this.editor.getValue()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: this.fileName }) as HTMLAnchorElement;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private applyTheme(): void {
    const resolved =
      this.theme === 'auto'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : this.theme;
    document.documentElement.dataset.theme = resolved;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'light' ? '#ffffff' : '#12141a');
  }
}
