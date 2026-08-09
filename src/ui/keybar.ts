import type { Editor } from '../editor/core/editor.ts';
import type { TextInput } from '../editor/input/textInput.ts';
import {
  deleteBackward,
  indentLines,
  insertNewline,
  insertTab,
  insertText,
  moveWord,
  toggleComment,
} from '../editor/core/commands.ts';

interface KeyDef {
  label: string;
  title: string;
  /** Held-down repeat, for the keys where that makes sense. */
  repeat?: boolean;
  wide?: boolean;
  run: () => void;
}

const REPEAT_DELAY = 320;
const REPEAT_INTERVAL = 55;

/**
 * The accessory key bar.
 *
 * Soft keyboards have no Tab, no Escape, no arrow keys, and bury `{`, `[` and
 * `|` two layers deep — which is most of what writing code consists of. This
 * bar puts them one tap away, directly above the keyboard.
 *
 * Every button suppresses its default action on `pointerdown` so the hidden
 * textarea never loses focus; if it did, the keyboard would close on each tap.
 */
export class KeyBar {
  readonly element: HTMLDivElement;
  private repeatTimer: number | null = null;
  private repeatInterval: number | null = null;

  private readonly editor: Editor;
  private readonly input: TextInput;

  constructor(editor: Editor, input: TextInput) {
    this.editor = editor;
    this.input = input;
    this.element = document.createElement('div');
    this.element.className = 'keybar';

    const nav = document.createElement('div');
    nav.className = 'keybar-nav';
    for (const key of this.navKeys()) nav.appendChild(this.button(key));

    const symbols = document.createElement('div');
    symbols.className = 'keybar-symbols';
    symbols.dataset.scrollable = 'true';
    for (const key of this.symbolKeys()) symbols.appendChild(this.button(key));

    this.element.append(nav, symbols);
  }

  private navKeys(): KeyDef[] {
    const editor = this.editor;
    return [
      { label: '←', title: 'Left', repeat: true, run: () => editor.moveHorizontal(-1, false) },
      { label: '↑', title: 'Up', repeat: true, run: () => editor.moveVertical(-1, false) },
      { label: '↓', title: 'Down', repeat: true, run: () => editor.moveVertical(1, false) },
      { label: '→', title: 'Right', repeat: true, run: () => editor.moveHorizontal(1, false) },
    ];
  }

  private symbolKeys(): KeyDef[] {
    const editor = this.editor;
    const insert = (text: string): KeyDef => ({
      label: text,
      title: text,
      run: () => insertText(editor, text),
    });

    return [
      { label: 'Tab', title: 'Tab', wide: true, run: () => insertTab(editor) },
      { label: '⌫', title: 'Backspace', repeat: true, run: () => deleteBackward(editor) },
      { label: '↵', title: 'New line', run: () => insertNewline(editor) },
      { label: '⇤', title: 'Outdent', run: () => indentLines(editor, -1) },
      { label: '⇥', title: 'Indent', run: () => indentLines(editor, 1) },
      { label: '⌥←', title: 'Previous word', repeat: true, run: () => moveWord(editor, -1, false) },
      { label: '⌥→', title: 'Next word', repeat: true, run: () => moveWord(editor, 1, false) },
      insert('{'),
      insert('}'),
      insert('('),
      insert(')'),
      insert('['),
      insert(']'),
      insert('<'),
      insert('>'),
      insert('='),
      insert('!'),
      insert('&'),
      insert('|'),
      insert('+'),
      insert('-'),
      insert('*'),
      insert('/'),
      insert('%'),
      insert(':'),
      insert(';'),
      insert(','),
      insert('.'),
      insert('"'),
      insert("'"),
      insert('`'),
      insert('_'),
      insert('#'),
      insert('$'),
      insert('@'),
      insert('^'),
      insert('~'),
      insert('?'),
      insert('\\'),
      { label: '//', title: 'Toggle comment', wide: true, run: () => toggleComment(editor) },
    ];
  }

  private button(key: KeyDef): HTMLButtonElement {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = key.wide ? 'keybar-key keybar-key-wide' : 'keybar-key';
    node.textContent = key.label;
    node.title = key.title;
    node.setAttribute('aria-label', key.title);

    const fire = () => {
      key.run();
      this.input.focus();
    };

    node.addEventListener('pointerdown', (event) => {
      // Keeping focus on the textarea is what stops the keyboard from closing.
      event.preventDefault();
      node.classList.add('is-pressed');
      fire();
      if (key.repeat) {
        this.repeatTimer = window.setTimeout(() => {
          this.repeatInterval = window.setInterval(fire, REPEAT_INTERVAL);
        }, REPEAT_DELAY);
      }
    });

    const stop = () => {
      node.classList.remove('is-pressed');
      this.stopRepeat();
    };
    node.addEventListener('pointerup', stop);
    node.addEventListener('pointercancel', stop);
    node.addEventListener('pointerleave', stop);

    return node;
  }

  private stopRepeat(): void {
    if (this.repeatTimer !== null) clearTimeout(this.repeatTimer);
    if (this.repeatInterval !== null) clearInterval(this.repeatInterval);
    this.repeatTimer = null;
    this.repeatInterval = null;
  }

  /** Only worth showing while the keyboard is up. */
  setVisible(visible: boolean): void {
    this.element.classList.toggle('keybar-hidden', !visible);
  }
}
