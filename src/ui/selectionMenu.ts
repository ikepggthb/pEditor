import type { Editor } from '../editor/core/editor.ts';
import type { Position } from '../editor/model/position.ts';
import { selectionIsEmpty, selectionRange, selectionStart, selectionEnd } from '../editor/model/selection.ts';
import { readClipboard, writeClipboard } from './clipboard.ts';

/** How long the paste bubble stays up when there is nothing selected. */
const IDLE_HIDE_MS = 4000;

interface Item {
  label: string;
  /** Shown only when there is something selected. */
  needsSelection?: boolean;
  /** Changes the text, so hidden while the document is only being viewed. */
  edits?: boolean;
  run: () => void | Promise<void>;
}

/**
 * The cut/copy/paste bubble.
 *
 * The editor draws its own selection and suppresses the browser's, which is
 * what lets a selection survive a scroll and gives the drag handles something
 * to move — but it also means the platform never offers its own text menu,
 * because as far as the platform is concerned nothing is selected. Without a
 * replacement there is no way to copy at all on a phone: there is no Ctrl-C,
 * and long-press belongs to the editor.
 */
export class SelectionMenu {
  readonly element: HTMLDivElement;
  private readonly editor: Editor;
  private readonly onDone: () => void;
  private readonly isBusy: () => boolean;
  private buttons: { node: HTMLButtonElement; item: Item }[] = [];
  private disposers: (() => void)[] = [];
  private hideTimer: number | null = null;
  private suppressed = false;
  /** Whether the bubble is wanted at all, separately from where it goes. */
  private wanted = false;

  constructor(editor: Editor, options: { onDone: () => void; isBusy: () => boolean }) {
    this.editor = editor;
    this.onDone = options.onDone;
    this.isBusy = options.isBusy;

    this.element = document.createElement('div');
    this.element.className = 'pe-menu';

    for (const item of this.items()) {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'pe-menu-item';
      node.textContent = item.label;
      // The editor must not lose its selection to the tap that acts on it.
      node.addEventListener('pointerdown', (event) => event.preventDefault());
      node.addEventListener('click', () => void this.run(item));
      this.buttons.push({ node, item });
      this.element.appendChild(node);
    }
  }

  private items(): Item[] {
    const editor = this.editor;
    return [
      {
        label: 'Cut',
        needsSelection: true,
        edits: true,
        run: async () => {
          const text = editor.selectedText;
          if (await writeClipboard(text)) editor.edit(selectionRange(editor.selection), '', 'delete');
        },
      },
      {
        label: 'Copy',
        needsSelection: true,
        run: () => void writeClipboard(editor.selectedText),
      },
      {
        label: 'Paste',
        edits: true,
        run: async () => {
          const text = await readClipboard();
          if (text) editor.insert(text, 'paste');
        },
      },
      { label: 'Select all', run: () => editor.selectAll() },
    ];
  }

  private async run(item: Item): Promise<void> {
    await item.run();
    this.onDone();
    this.update();
  }

  attach(): void {
    this.editor.renderer.editor.appendChild(this.element);

    // Selecting something always earns the bubble. A bare caret does not:
    // arrow keys move one all the time, and a menu that reappeared on every
    // keystroke would spend the session covering the line being typed.
    this.disposers.push(
      this.editor.on('selection', () => {
        if (selectionIsEmpty(this.editor.selection)) this.update();
        else this.reveal();
      }),
    );
    // Typing is the clearest signal that the menu is not what is wanted.
    this.disposers.push(
      this.editor.on('change', () => {
        if (selectionIsEmpty(this.editor.selection)) this.hide();
        else this.update();
      }),
    );
    for (const event of ['focus', 'scroll', 'config'] as const) {
      this.disposers.push(this.editor.on(event, () => this.update()));
    }
    this.update();
  }

  /** Put the bubble up — after a tap, or when something has been selected. */
  reveal(): void {
    this.wanted = true;
    this.update();
  }

  hide(): void {
    this.wanted = false;
    this.element.classList.remove('pe-menu-visible');
  }

  detach(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.element.remove();
  }

  /** Hide while a handle is being dragged; the bubble would sit under the thumb. */
  setSuppressed(suppressed: boolean): void {
    if (this.suppressed === suppressed) return;
    this.suppressed = suppressed;
    this.update();
  }

  update(): void {
    const editor = this.editor;
    const selection = editor.selection;
    const empty = selectionIsEmpty(selection);

    // Nothing to offer at a bare caret in a viewer: there is no paste, and
    // Select all on its own is not worth a bubble over the text.
    if (empty && editor.readOnly) {
      this.element.classList.remove('pe-menu-visible');
      return;
    }
    if (!this.wanted || !editor.isFocused || this.suppressed || this.isBusy()) {
      this.element.classList.remove('pe-menu-visible');
      return;
    }

    for (const { node, item } of this.buttons) {
      node.hidden =
        (Boolean(item.needsSelection) && empty) || (Boolean(item.edits) && editor.readOnly);
    }

    // With a selection the bubble stays for as long as the selection does. With
    // only a caret it is a paste offer, and an offer that never goes away is
    // just something covering the code.
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (empty) this.hideTimer = window.setTimeout(() => this.hide(), IDLE_HIDE_MS);

    this.element.classList.add('pe-menu-visible');
    this.place(empty ? selection.head : selectionStart(selection), empty ? null : selectionEnd(selection));
  }

  /**
   * Above the selection, or below it when there is no room — the same rule the
   * platform menus follow, and for the same reason: a bubble over the top edge
   * of the viewport is a bubble you cannot tap.
   */
  private place(from: Position, to: Position | null): void {
    const editor = this.editor;
    const host = editor.renderer.editor.getBoundingClientRect();
    const view = editor.renderer.scroller.getBoundingClientRect();
    const startRect = editor.caretClientRect(from);
    const endRect = to ? editor.caretClientRect(to) : startRect;

    // Off-screen anchors would park the bubble at the edge pointing at nothing.
    if (endRect.y + endRect.height < view.top || startRect.y > view.bottom) {
      this.element.classList.remove('pe-menu-visible');
      return;
    }

    const size = this.element.getBoundingClientRect();
    const gap = 8;
    let top = startRect.y - size.height - gap;
    if (top < view.top + 2) {
      const below = endRect.y + endRect.height + gap;
      top = below + size.height > view.bottom ? view.top + 2 : below;
    }

    const centre = to ? (startRect.x + endRect.x) / 2 : startRect.x;
    const left = Math.max(
      view.left + 4,
      Math.min(centre - size.width / 2, view.right - size.width - 4),
    );
    this.element.style.transform = `translate(${(left - host.left).toFixed(1)}px, ${(top - host.top).toFixed(1)}px)`;
  }
}
