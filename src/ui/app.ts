import { Editor, DEFAULT_CONFIG, type EditorConfig } from '../editor/core/editor.ts';
import { TextInput } from '../editor/input/textInput.ts';
import { SelectionHandles } from '../editor/input/handles.ts';
import { PointerInput } from '../editor/input/pointer.ts';
import { LANGUAGES, languageForFilename } from '../editor/syntax/highlighter.ts';
import { columnAt } from '../editor/view/columns.ts';
import { KeyBar } from './keybar.ts';
import { h, segmentRow, selectRow, toggleRow } from './dom.ts';
import { debounce, loadDocument, loadSettings, saveDocument, saveSettings, throttle } from './storage.ts';
import { lockDocumentScroll, trackVisualViewport } from './viewport.ts';
import { SAMPLE_FILENAME, SAMPLE_TEXT } from './sample.ts';

type Theme = 'auto' | 'dark' | 'light';
const THEME_KEY = 'peditor.theme.v1';

/** The application shell: chrome around the editor, plus what persists. */
export class App {
  private editor: Editor;
  private input: TextInput;
  private handles: SelectionHandles;
  private pointer: PointerInput;
  private keybar: KeyBar;

  private root: HTMLDivElement;
  private nameField: HTMLInputElement;
  private statusPosition: HTMLElement;
  private statusLanguage: HTMLElement;
  private statusSize: HTMLElement;
  private sheet: HTMLDivElement;
  private undoButton: HTMLButtonElement;
  private redoButton: HTMLButtonElement;

  private fileName: string;
  private theme: Theme = (localStorage.getItem(THEME_KEY) as Theme) ?? 'auto';

  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    const saved = loadDocument();
    const settings = loadSettings() ?? {};

    this.fileName = saved?.name ?? SAMPLE_FILENAME;
    this.editor = new Editor(saved?.text ?? SAMPLE_TEXT, { ...DEFAULT_CONFIG, ...settings });
    this.input = new TextInput(this.editor);
    this.handles = new SelectionHandles(this.editor, () => this.input.syncPosition());
    this.pointer = new PointerInput(this.editor, this.input, this.handles);
    this.keybar = new KeyBar(this.editor, this.input);

    this.nameField = h('input', {
      class: 'topbar-name',
      value: this.fileName,
      spellcheck: 'false',
      'aria-label': 'File name',
    }) as HTMLInputElement;

    this.undoButton = h('button', { type: 'button', class: 'icon-btn', title: 'Undo', text: '↶' }) as HTMLButtonElement;
    this.redoButton = h('button', { type: 'button', class: 'icon-btn', title: 'Redo', text: '↷' }) as HTMLButtonElement;

    this.statusPosition = h('span', { class: 'status-item', text: 'Ln 1, Col 1' });
    this.statusLanguage = h('span', { class: 'status-item' });
    this.statusSize = h('span', { class: 'status-item' });

    this.sheet = h('div', { class: 'sheet', hidden: true }) as HTMLDivElement;
    this.root = h('div', { class: 'app' }) as HTMLDivElement;
  }

  mount(): void {
    const menuButton = h('button', { type: 'button', class: 'icon-btn', title: 'Settings', text: '⋯' });
    const keyboardButton = h('button', { type: 'button', class: 'icon-btn', title: 'Hide keyboard', text: '⌄' });

    const topbar = h('header', { class: 'topbar' }, [
      this.nameField,
      this.undoButton,
      this.redoButton,
      menuButton,
    ]);

    const editorHost = h('div', { class: 'editor-host' });
    const statusbar = h('footer', { class: 'statusbar' }, [
      this.statusPosition,
      h('span', { class: 'status-spacer' }),
      this.statusLanguage,
      this.statusSize,
      keyboardButton,
    ]);

    this.root.append(topbar, editorHost, statusbar, this.keybar.element, this.sheet);
    this.host.appendChild(this.root);

    this.editor.mount(editorHost);
    this.input.attach();
    this.handles.attach();
    this.pointer.attach();

    this.applyTheme();
    this.editor.setLanguage(languageForFilename(this.fileName).id);
    this.buildSheet();

    menuButton.addEventListener('click', () => this.toggleSheet());
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
      this.fileName = this.nameField.value.trim() || 'untitled.txt';
      this.nameField.value = this.fileName;
      this.editor.setLanguage(languageForFilename(this.fileName).id);
      this.updateStatus();
      this.persist();
    });
    this.nameField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.nameField.blur();
    });

    const persist = debounce(() => this.persist(), 900);
    this.editor.on('change', () => {
      this.updateStatus();
      this.updateSize();
      persist();
    });
    this.editor.on('selection', () => this.updateStatus());
    this.editor.on('focus', () => this.keybar.setVisible(this.editor.isFocused));
    this.editor.on('config', () => {
      this.updateStatus();
      saveSettings(this.editor.config);
    });

    // The browser may kill the tab without warning; take a last snapshot.
    window.addEventListener('pagehide', () => this.persist());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.persist();
    });

    lockDocumentScroll();
    trackVisualViewport(this.root);
    this.keybar.setVisible(false);
    this.updateStatus();
    this.updateSize();
  }

  private persist(): void {
    saveDocument({
      name: this.fileName,
      text: this.editor.getValue(),
      languageId: this.editor.language.id,
      savedAt: Date.now(),
    });
  }

  /** Cheap enough to run on every keystroke and cursor move. */
  private updateStatus(): void {
    const head = this.editor.selection.head;
    const column = columnAt(this.editor.buffer.line(head.line), head.ch, this.editor.config.tabSize) + 1;
    this.statusPosition.textContent = `Ln ${head.line + 1}, Col ${column}`;
    this.statusLanguage.textContent = this.editor.language.name;

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

  private toggleSheet(): void {
    const open = this.sheet.hasAttribute('hidden');
    if (open) {
      this.sheet.removeAttribute('hidden');
      requestAnimationFrame(() => this.sheet.classList.add('sheet-open'));
    } else {
      this.sheet.classList.remove('sheet-open');
      setTimeout(() => this.sheet.setAttribute('hidden', ''), 200);
    }
  }

  private buildSheet(): void {
    const config = this.editor.config;
    const set = (patch: Partial<EditorConfig>) => this.editor.setConfig(patch);

    const fontValue = h('span', { class: 'stepper-value', text: `${config.fontSize}px` });
    const smaller = h('button', { type: 'button', class: 'stepper-btn', text: '−' });
    const larger = h('button', { type: 'button', class: 'stepper-btn', text: '+' });
    const stepFont = (delta: number) => {
      const size = Math.max(10, Math.min(28, this.editor.config.fontSize + delta));
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
      this.fileName = file.name;
      this.nameField.value = file.name;
      this.editor.setValue(text, file.name);
      this.persist();
      this.toggleSheet();
    });

    this.sheet.append(
      h('div', { class: 'sheet-handle' }),
      h('div', { class: 'sheet-title', text: 'Settings' }),

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
      segmentRow('Tab size', [
        { value: '2', label: '2' },
        { value: '4', label: '4' },
        { value: '8', label: '8' },
      ], String(config.tabSize), (value) => set({ tabSize: Number(value) })),

      h('div', { class: 'sheet-row' }, [
        h('span', { text: 'Font size' }),
        h('div', { class: 'stepper' }, [smaller, fontValue, larger]),
      ]),

      toggleRow('Word wrap', config.wordWrap, (value) => set({ wordWrap: value })),
      toggleRow('Line numbers', config.lineNumbers, (value) => set({ lineNumbers: value })),
      toggleRow('Insert spaces', config.insertSpaces, (value) => set({ insertSpaces: value })),
      toggleRow('Auto-close brackets', config.autoCloseBrackets, (value) => set({ autoCloseBrackets: value })),
      toggleRow('Auto indent', config.autoIndent, (value) => set({ autoIndent: value })),

      h('div', { class: 'sheet-actions' }, [
        this.actionButton('Open file…', () => fileInput.click()),
        this.actionButton('Download', () => this.download()),
        this.actionButton('Copy all', () => void navigator.clipboard?.writeText(this.editor.getValue())),
        this.actionButton('New', () => {
          if (!confirm('Discard the current document?')) return;
          this.fileName = 'untitled.txt';
          this.nameField.value = this.fileName;
          this.editor.setValue('', this.fileName);
          this.persist();
          this.toggleSheet();
        }),
      ]),

      this.actionButton('Close', () => this.toggleSheet(), 'sheet-close'),
      fileInput,
    );
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
