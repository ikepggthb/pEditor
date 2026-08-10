import { Editor, DEFAULT_CONFIG, type EditorConfig } from '../editor/core/editor.ts';
import { TextInput, type InputMode } from '../editor/input/textInput.ts';
import { SelectionHandles } from '../editor/input/handles.ts';
import { PointerInput } from '../editor/input/pointer.ts';
import { PinchZoom } from '../editor/input/pinch.ts';
import { LANGUAGES, languageForFilename } from '../editor/syntax/highlighter.ts';
import { columnAt } from '../editor/view/columns.ts';
import { KeyBar } from './keybar.ts';
import { CodeKeyboard } from './keyboard/keyboard.ts';
import { FrameMeter } from './frameMeter.ts';
import { h, segmentRow, selectRow, toggleRow } from './dom.ts';
import { debounce, loadDocument, loadSettings, saveDocument, saveSettings, throttle } from './storage.ts';
import { lockDocumentScroll, trackVisualViewport } from './viewport.ts';
import { SAMPLE_FILENAME, SAMPLE_TEXT } from './sample.ts';

type Theme = 'auto' | 'dark' | 'light';
const THEME_KEY = 'peditor.theme.v1';
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

  private root: HTMLDivElement;
  private nameField: HTMLInputElement;
  private statusPosition: HTMLElement;
  private statusLanguage: HTMLElement;
  private statusSize: HTMLElement;
  private statusFrames: HTMLElement;
  private sheet: HTMLDivElement;
  private undoButton: HTMLButtonElement;
  private redoButton: HTMLButtonElement;

  private fileName: string;
  private theme: Theme = (localStorage.getItem(THEME_KEY) as Theme) ?? 'auto';
  /** Which keyboard the editor uses. The code keyboard is the default; the
   *  platform one is a tap away and is the only one that can run an IME. */
  private keyboardMode: InputMode = (localStorage.getItem(KEYBOARD_KEY) as InputMode) ?? 'custom';
  /** Frame timing readout, off unless asked for — see ui/frameMeter.ts. */
  private frameMeter = new FrameMeter();
  private showFrameRate = localStorage.getItem(FRAME_RATE_KEY) === '1';

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
    this.pinch = new PinchZoom(this.editor);
    this.keybar = new KeyBar(this.editor, this.input, () => this.setKeyboardMode('custom'));
    this.keyboard = new CodeKeyboard(this.editor, {
      onSystemKeyboard: () => this.setKeyboardMode('system'),
      onHeightChange: (height) => localStorage.setItem(KEYBOARD_HEIGHT_KEY, String(height)),
      initialHeight: Number(localStorage.getItem(KEYBOARD_HEIGHT_KEY)) || undefined,
    });

    this.nameField = h('input', {
      class: 'topbar-name',
      value: this.fileName,
      spellcheck: 'false',
      'aria-label': 'File name',
    }) as HTMLInputElement;

    this.undoButton = h('button', { type: 'button', class: 'icon-btn', title: 'Undo', text: '↶' }) as HTMLButtonElement;
    this.redoButton = h('button', { type: 'button', class: 'icon-btn', title: 'Redo', text: '↷' }) as HTMLButtonElement;

    this.statusPosition = h('span', { class: 'status-item', text: 'Ln 1, Col 1' });
    this.statusLanguage = h('span', { class: 'status-item status-language' });
    this.statusSize = h('span', { class: 'status-item status-size' });
    this.statusFrames = h('span', { class: 'status-item status-frames', hidden: true });

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
      this.sheet,
    );
    this.host.appendChild(this.root);

    this.editor.mount(editorHost);
    this.input.attach();
    this.handles.attach();
    this.pointer.attach();
    this.pinch.attach();
    this.input.setMode(this.keyboardMode);

    this.applyTheme();
    this.editor.setLanguage(languageForFilename(this.fileName).id);
    this.buildSheet();

    menuButton.addEventListener('click', () => this.openSheet());
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
    this.editor.on('focus', () => this.syncKeyboards());
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
    this.syncKeyboards();
    this.applyFrameRate();
    this.updateStatus();
    this.updateSize();
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

  /** Show whichever keyboard is selected, and only while the editor is active. */
  private syncKeyboards(): void {
    const active = this.editor.isFocused;
    const custom = this.keyboardMode === 'custom';
    this.keybar.setVisible(active && !custom);
    this.keyboard.setVisible(active && custom);
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
      this.closeSheet();
    });

    const grip = h('div', { class: 'sheet-grip' }, [
      h('div', { class: 'sheet-handle' }),
      h('div', { class: 'sheet-title', text: 'Settings' }),
    ]);
    this.bindSheetDrag(grip);

    this.sheet.append(
      grip,

      segmentRow('Keyboard', [
        { value: 'custom', label: 'Code' },
        { value: 'system', label: 'System' },
      ], this.keyboardMode, (value) => this.setKeyboardMode(value as InputMode)),

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
          this.fileName = 'untitled.txt';
          this.nameField.value = this.fileName;
          this.editor.setValue('', this.fileName);
          this.persist();
          this.closeSheet();
        }),
      ]),

      this.actionButton('Close', () => this.closeSheet(), 'sheet-close'),
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
