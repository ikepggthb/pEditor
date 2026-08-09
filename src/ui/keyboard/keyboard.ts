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
export interface CodeKeyboardOptions {
  /** Hand off to the platform keyboard (the only one with an IME). */
  onSystemKeyboard: () => void;
  /** Called when the user finishes resizing, so the height can be persisted. */
  onHeightChange: (height: number) => void;
  initialHeight?: number;
}

const MIN_HEIGHT = 150;

export class CodeKeyboard {
  readonly element: HTMLDivElement;
  private readonly editor: Editor;
  private readonly options: CodeKeyboardOptions;
  private readonly rowsHost: HTMLDivElement;

  private layer: LayerId = 'letters';
  private shift: ShiftState = 'off';
  /** Keys whose label depends on shift, so they can be relabelled in place. */
  private shiftable: { node: HTMLElement; key: Key }[] = [];
  private shiftNode: HTMLElement | null = null;
  private unbind: (() => void)[] = [];
  private height = 0;

  constructor(editor: Editor, options: CodeKeyboardOptions) {
    this.editor = editor;
    this.options = options;

    this.element = document.createElement('div');
    this.element.className = 'kbd kbd-hidden';
    this.element.appendChild(this.buildGrip());

    this.rowsHost = document.createElement('div');
    this.rowsHost.className = 'kbd-rows';
    this.element.appendChild(this.rowsHost);

    if (options.initialHeight) this.setHeight(options.initialHeight);
    this.build();
  }

  /** The bar along the top edge; drag it to make the keyboard taller or shorter. */
  private buildGrip(): HTMLElement {
    const grip = document.createElement('div');
    grip.className = 'kbd-grip';
    grip.setAttribute('aria-label', 'Resize keyboard');
    grip.appendChild(document.createElement('span'));

    let startY = 0;
    let startHeight = 0;
    let pending = 0;
    let frame = 0;

    grip.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      startY = event.clientY;
      startHeight = this.element.getBoundingClientRect().height;
      grip.setPointerCapture(event.pointerId);
      grip.classList.add('is-dragging');
    });

    grip.addEventListener('pointermove', (event) => {
      if (!grip.hasPointerCapture(event.pointerId)) return;
      // Dragging up (negative delta) makes it taller.
      pending = startHeight - (event.clientY - startY);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        this.setHeight(pending);
      });
    });

    const end = (event: PointerEvent) => {
      if (!grip.hasPointerCapture(event.pointerId)) return;
      grip.releasePointerCapture(event.pointerId);
      grip.classList.remove('is-dragging');
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
        this.setHeight(pending);
      }
      this.options.onHeightChange(this.height);
      this.editor.requestScrollToCaret();
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);

    return grip;
  }

  private setHeight(height: number): void {
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    // Leave at least a few lines of the document visible above it.
    const max = Math.max(MIN_HEIGHT, Math.min(560, viewport * 0.72));
    const next = Math.round(Math.max(MIN_HEIGHT, Math.min(max, height)));
    if (next === this.height) return;
    this.height = next;
    this.element.style.setProperty('--kbd-h', `${next}px`);
  }

  private build(): void {
    for (const dispose of this.unbind) dispose();
    this.unbind = [];
    this.shiftable = [];
    this.shiftNode = null;
    this.rowsHost.textContent = '';

    for (const row of LAYERS[this.layer].rows) {
      const rowNode = document.createElement('div');
      rowNode.className = 'kbd-row';
      for (const key of row) rowNode.appendChild(this.buildKey(key));
      this.rowsHost.appendChild(rowNode);
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
        this.options.onSystemKeyboard();
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
