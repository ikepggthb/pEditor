import type { Editor } from '../../editor/core/editor.ts';
import {
  deleteBackward,
  insertNewline,
  insertTab,
  insertText,
} from '../../editor/core/commands.ts';
import { bindKey } from '../holdRepeat.ts';
import { LAYERS, type Key, type KeyAction, type LayerId } from './layouts.ts';

type ShiftState = 'off' | 'once' | 'lock';

/** Actions that should keep firing while the key is held. */
const REPEATING: ReadonlySet<KeyAction> = new Set<KeyAction>([
  'backspace',
  'left',
  'right',
  'up',
  'down',
  'space',
]);

/**
 * An on-screen keyboard built for code.
 *
 * The OS keyboard is designed for prose: digits and symbols sit behind layer
 * switches, autocorrect fights identifiers, and the keys a program is mostly
 * made of are two taps deep. This one keeps digits permanently visible, gives
 * brackets and operators a layer of their own, and adds the multi-character
 * sequences (`=>`, `::`, `!=`) that would otherwise be typed a key at a time.
 *
 * It deliberately cannot do everything: composing Japanese needs an IME, which
 * only the platform keyboard has. The ⌨ key hands off to it, which is why that
 * key sits in the fixed bottom row rather than in a menu.
 */
export class CodeKeyboard {
  readonly element: HTMLDivElement;
  private readonly editor: Editor;
  private readonly onSystemKeyboard: () => void;

  private layer: LayerId = 'letters';
  private shift: ShiftState = 'off';
  /** Keys whose label depends on shift, so they can be relabelled in place. */
  private shiftable: { node: HTMLElement; key: Key }[] = [];
  private shiftNode: HTMLElement | null = null;
  private unbind: (() => void)[] = [];

  constructor(editor: Editor, onSystemKeyboard: () => void) {
    this.editor = editor;
    this.onSystemKeyboard = onSystemKeyboard;
    this.element = document.createElement('div');
    this.element.className = 'kbd kbd-hidden';
    this.build();
  }

  private build(): void {
    for (const dispose of this.unbind) dispose();
    this.unbind = [];
    this.shiftable = [];
    this.shiftNode = null;
    this.element.textContent = '';

    for (const row of LAYERS[this.layer].rows) {
      const rowNode = document.createElement('div');
      rowNode.className = 'kbd-row';
      for (const key of row) rowNode.appendChild(this.buildKey(key));
      this.element.appendChild(rowNode);
    }
    this.applyShiftLabels();
  }

  private buildKey(key: Key): HTMLElement {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'kbd-key';
    if (key.variant) node.classList.add(`kbd-key-${key.variant}`);
    node.style.flexGrow = String(key.flex ?? 1);
    node.textContent = key.label;
    node.setAttribute('aria-label', key.action ?? key.text ?? key.label);

    if (key.shift) this.shiftable.push({ node, key });
    if (key.action === 'shift') this.shiftNode = node;

    this.unbind.push(
      bindKey(node, {
        repeat: key.action ? REPEATING.has(key.action) : false,
        onFire: () => this.press(key),
      }),
    );
    return node;
  }

  private press(key: Key): void {
    if (key.action) {
      this.runAction(key.action);
      return;
    }
    const text = this.shift !== 'off' && key.shift ? key.shift : key.text;
    if (text === undefined) return;

    insertText(this.editor, text);
    // A one-shot shift is spent by the next character, as on every phone.
    if (this.shift === 'once') this.setShift('off');
  }

  private runAction(action: KeyAction): void {
    const editor = this.editor;
    switch (action) {
      case 'backspace':
        deleteBackward(editor);
        break;
      case 'enter':
        insertNewline(editor);
        break;
      case 'tab':
        insertTab(editor);
        break;
      case 'space':
        insertText(editor, ' ');
        if (this.shift === 'once') this.setShift('off');
        break;
      case 'left':
        editor.moveHorizontal(-1, false);
        break;
      case 'right':
        editor.moveHorizontal(1, false);
        break;
      case 'up':
        editor.moveVertical(-1, false);
        break;
      case 'down':
        editor.moveVertical(1, false);
        break;
      case 'shift':
        // Tap for the next letter, tap again to lock, once more to clear.
        this.setShift(this.shift === 'off' ? 'once' : this.shift === 'once' ? 'lock' : 'off');
        break;
      case 'toggleLayer':
        this.layer = this.layer === 'letters' ? 'symbols' : 'letters';
        this.build();
        break;
      case 'systemKeyboard':
        this.onSystemKeyboard();
        break;
    }
  }

  private setShift(next: ShiftState): void {
    if (this.shift === next) return;
    this.shift = next;
    this.applyShiftLabels();
  }

  private applyShiftLabels(): void {
    const on = this.shift !== 'off';
    for (const { node, key } of this.shiftable) {
      const label = on && key.shift ? key.shift : key.label;
      if (node.textContent !== label) node.textContent = label;
    }
    this.shiftNode?.classList.toggle('is-active', this.shift === 'once');
    this.shiftNode?.classList.toggle('is-locked', this.shift === 'lock');
  }

  setVisible(visible: boolean): void {
    const changed = this.element.classList.contains('kbd-hidden') === visible;
    this.element.classList.toggle('kbd-hidden', !visible);
    // The editor just got shorter or taller; keep the caret in view.
    if (changed) this.editor.requestScrollToCaret();
  }

  get isVisible(): boolean {
    return !this.element.classList.contains('kbd-hidden');
  }
}
