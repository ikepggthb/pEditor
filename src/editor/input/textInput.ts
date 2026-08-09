import type { Editor } from '../core/editor.ts';
import { deleteBackward, deleteForward, deleteWordBackward, insertNewline, insertText } from '../core/commands.ts';
import { handleKeydown } from './keymap.ts';
import { selectionRange } from '../model/selection.ts';

/**
 * The bridge between the browser's text entry machinery and the editor.
 *
 * A hidden textarea holds focus. It exists for two reasons that a phone makes
 * unavoidable: it is what summons the on-screen keyboard, and it is the only
 * way to receive IME composition events — which is how Japanese, Chinese and
 * Korean text (and Android autocorrect) is entered.
 *
 * The textarea's own value is kept empty and never used as the source of
 * truth; every event is translated into an editor command instead.
 */
export type InputMode = 'system' | 'custom';

export class TextInput {
  readonly textarea: HTMLTextAreaElement;
  private disposers: (() => void)[] = [];
  /**
   * Which keyboard is driving the editor. In 'custom' mode the textarea is
   * deliberately left unfocused so the OS keyboard stays closed, while the
   * editor keeps its caret and acts focused — the app's own keyboard is
   * supplying the keystrokes.
   */
  private mode: InputMode = 'system';

  private readonly editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
    const textarea = document.createElement('textarea');
    textarea.className = 'pe-input';
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('autocorrect', 'off');
    textarea.setAttribute('autocomplete', 'off');
    textarea.setAttribute('spellcheck', 'false');
    textarea.setAttribute('aria-label', 'Editor');
    textarea.setAttribute('enterkeyhint', 'enter');
    textarea.tabIndex = 0;
    this.textarea = textarea;
  }

  attach(): void {
    const { editor, textarea } = this;
    editor.renderer.editor.appendChild(textarea);

    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Document,
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, handler as EventListener, options);
      this.disposers.push(() => target.removeEventListener(type, handler as EventListener, options));
    };

    on(textarea, 'keydown', (event) => {
      if (handleKeydown(editor, event)) {
        event.preventDefault();
        // preventDefault on keydown also suppresses the matching `beforeinput`,
        // so hardware keys can never be applied twice.
      }
    });

    on(textarea, 'beforeinput', (event) => this.onBeforeInput(event as InputEvent));
    on(textarea, 'input', () => {
      // Anything that slipped past `beforeinput` (rare, but some Android IMEs
      // do this) still lands here; take the text and reset.
      if (editor.isComposing) return;
      const value = textarea.value;
      if (value) {
        textarea.value = '';
        insertText(editor, value);
      }
    });

    on(textarea, 'compositionstart', () => editor.beginComposition());
    on(textarea, 'compositionupdate', (event) => {
      editor.updateComposition((event as CompositionEvent).data ?? '');
    });
    on(textarea, 'compositionend', (event) => {
      editor.endComposition((event as CompositionEvent).data ?? '');
      textarea.value = '';
    });

    on(textarea, 'focus', () => {
      editor.setFocused(true);
      this.syncPosition();
    });
    on(textarea, 'blur', () => {
      // Losing focus on purpose to close the OS keyboard is not the editor
      // losing focus — the custom keyboard is still typing into it.
      if (this.mode === 'system') editor.setFocused(false);
    });

    on(textarea, 'copy', (event) => this.onCopy(event as ClipboardEvent, false));
    on(textarea, 'cut', (event) => this.onCopy(event as ClipboardEvent, true));
    on(textarea, 'paste', (event) => {
      const text = (event as ClipboardEvent).clipboardData?.getData('text/plain');
      if (text === undefined) return;
      event.preventDefault();
      editor.insert(text, 'paste');
    });

    this.disposers.push(editor.on('selection', () => this.syncPosition()));
    this.disposers.push(editor.on('scroll', () => this.syncPosition()));
  }

  detach(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.textarea.remove();
  }

  private onBeforeInput(event: InputEvent): void {
    const { editor } = this;
    if (editor.isComposing) return; // the IME owns the text until it commits

    switch (event.inputType) {
      case 'insertText':
      case 'insertReplacementText':
        event.preventDefault();
        if (event.data) insertText(editor, event.data);
        break;

      case 'insertLineBreak':
      case 'insertParagraph':
        event.preventDefault();
        insertNewline(editor);
        break;

      case 'deleteContentBackward':
      case 'deleteByCut':
        event.preventDefault();
        deleteBackward(editor);
        break;

      case 'deleteContentForward':
        event.preventDefault();
        deleteForward(editor);
        break;

      case 'deleteWordBackward':
        event.preventDefault();
        deleteWordBackward(editor);
        break;

      case 'historyUndo':
        event.preventDefault();
        editor.undo();
        break;

      case 'historyRedo':
        event.preventDefault();
        editor.redo();
        break;

      case 'insertFromPaste':
        // Handled by the `paste` listener, which has the clipboard data.
        break;

      default:
        event.preventDefault();
        break;
    }

    this.textarea.value = '';
  }

  private onCopy(event: ClipboardEvent, cut: boolean): void {
    const text = this.editor.selectedText;
    if (!text) return;
    event.preventDefault();
    event.clipboardData?.setData('text/plain', text);
    if (cut) this.editor.edit(selectionRange(this.editor.selection), '', 'delete');
  }

  /** Open the on-screen keyboard. Must run inside a user gesture on iOS. */
  focus(): void {
    if (this.mode === 'custom') {
      // Keep the caret alive without asking the platform for its keyboard.
      this.editor.setFocused(true);
      this.syncPosition();
      return;
    }
    if (document.activeElement !== this.textarea) {
      this.textarea.focus({ preventScroll: true });
    }
    this.syncPosition();
  }

  blur(): void {
    this.textarea.blur();
    this.editor.setFocused(false);
  }

  get inputMode(): InputMode {
    return this.mode;
  }

  /**
   * Switch keyboards. Call from inside a user gesture: returning to 'system'
   * focuses the textarea, and iOS only opens the keyboard for a focus that a
   * gesture asked for.
   */
  setMode(mode: InputMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === 'custom') this.textarea.blur();
    else if (this.editor.isFocused) this.focus();
  }

  /**
   * Park the textarea on the caret.
   *
   * IME candidate windows anchor to the focused element, so if the textarea
   * were parked in a corner the Japanese conversion popup would appear there
   * instead of under what you are typing.
   */
  syncPosition(): void {
    // Only worth doing for the element an IME is actually attached to. In
    // custom-keyboard mode, or while the textarea does not hold focus, there
    // is no candidate window to place and this runs on every scroll event.
    if (this.mode === 'custom' || document.activeElement !== this.textarea) return;

    const host = this.editor.renderer.editor;
    const hostRect = host.getBoundingClientRect();
    const caret = this.editor.caretClientRect();

    const x = Math.max(0, Math.min(caret.x - hostRect.left, hostRect.width - 2));
    const y = Math.max(0, Math.min(caret.y - hostRect.top, hostRect.height - caret.height));
    this.textarea.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    this.textarea.style.height = `${caret.height}px`;
  }
}
