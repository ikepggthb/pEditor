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
import { selectionRange } from '../editor/model/selection.ts';
import { bindKey } from './holdRepeat.ts';
import { readClipboard, writeClipboard } from './clipboard.ts';

interface KeyDef {
  label: string;
  title: string;
  /** Held-down repeat, for the keys where that makes sense. */
  repeat?: boolean;
  wide?: boolean;
  run: () => void;
}

/**
 * The accessory strip shown above the platform keyboard.
 *
 * While the OS keyboard is up it owns most of the screen and cannot be
 * rearranged, so this adds back the keys it lacks — Tab, arrows, brackets — in
 * the one strip of space left. When the app's own keyboard is in use this is
 * hidden, because that keyboard already has all of it.
 */
export class KeyBar {
  readonly element: HTMLDivElement;
  private readonly editor: Editor;
  private readonly input: TextInput;
  private unbind: (() => void)[] = [];

  constructor(editor: Editor, input: TextInput, onCustomKeyboard: () => void) {
    this.editor = editor;
    this.input = input;

    this.element = document.createElement('div');
    this.element.className = 'keybar';

    const nav = document.createElement('div');
    nav.className = 'keybar-nav';
    nav.appendChild(
      this.button(
        { label: '⌨', title: 'Code keyboard', run: onCustomKeyboard },
        { keepFocus: false },
      ),
    );
    for (const key of this.navKeys()) nav.appendChild(this.button(key));

    const symbols = document.createElement('div');
    symbols.className = 'keybar-symbols';
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
      // First, because they are the reason people reach for this strip at all
      // once they have a selection.
      { label: '⧉', title: 'Copy', run: () => void writeClipboard(editor.selectedText) },
      {
        label: '✂',
        title: 'Cut',
        run: () => {
          const text = editor.selectedText;
          if (!text) return;
          void writeClipboard(text).then((ok) => {
            if (ok) editor.edit(selectionRange(editor.selection), '', 'delete');
          });
        },
      },
      {
        label: '📋',
        title: 'Paste',
        run: () => {
          void readClipboard().then((text) => {
            if (text) editor.insert(text, 'paste');
          });
        },
      },
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

  private button(key: KeyDef, options: { keepFocus?: boolean } = {}): HTMLButtonElement {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = key.wide ? 'keybar-key keybar-key-wide' : 'keybar-key';
    node.textContent = key.label;
    node.title = key.title;
    node.setAttribute('aria-label', key.title);

    this.unbind.push(
      bindKey(node, {
        repeat: key.repeat,
        onFire: () => {
          key.run();
          // Switching keyboards must not immediately re-open the one we left.
          if (options.keepFocus !== false) this.input.focus();
        },
      }),
    );
    return node;
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle('keybar-hidden', !visible);
  }

  destroy(): void {
    for (const dispose of this.unbind) dispose();
    this.unbind = [];
  }
}
