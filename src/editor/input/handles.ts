import type { Editor } from '../core/editor.ts';
import type { Position } from '../model/position.ts';
import { selectionEnd, selectionIsEmpty, selectionStart } from '../model/selection.ts';

type HandleKind = 'caret' | 'start' | 'end';

/**
 * Draggable caret and selection handles.
 *
 * Precise caret placement is the thing a touch screen is worst at: a fingertip
 * covers several characters and hides the text underneath it. These give the
 * caret a grab point that sits below the line, so the target stays visible
 * while it is being moved — the same reason every mobile OS ships them.
 */
export class SelectionHandles {
  private readonly layer: HTMLDivElement;
  private readonly nodes: Record<HandleKind, HTMLDivElement>;
  private dragging: HandleKind | null = null;
  private grabOffset = { x: 0, y: 0 };
  private autoScroll = 0;
  private disposers: (() => void)[] = [];
  /** Hidden after a period of inactivity so they don't sit on top of the code. */
  private hideTimer: number | null = null;

  private readonly editor: Editor;
  private readonly onInteract: () => void;

  constructor(editor: Editor, onInteract: () => void) {
    this.editor = editor;
    this.onInteract = onInteract;
    this.layer = document.createElement('div');
    this.layer.className = 'pe-handles';
    this.nodes = {
      caret: this.createHandle('caret'),
      start: this.createHandle('start'),
      end: this.createHandle('end'),
    };
    this.layer.append(this.nodes.caret, this.nodes.start, this.nodes.end);
  }

  private createHandle(kind: HandleKind): HTMLDivElement {
    const node = document.createElement('div');
    node.className = `pe-handle pe-handle-${kind}`;
    node.dataset.kind = kind;
    const knob = document.createElement('div');
    knob.className = 'pe-handle-knob';
    node.appendChild(knob);
    return node;
  }

  attach(): void {
    this.editor.renderer.editor.appendChild(this.layer);

    const onPointerDown = (event: PointerEvent) => {
      const target = (event.target as HTMLElement).closest('.pe-handle') as HTMLElement | null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();

      const kind = target.dataset.kind as HandleKind;
      const anchor = this.anchorFor(kind);
      if (!anchor) return;

      const rect = this.editor.caretClientRect(anchor);
      this.dragging = kind;
      this.grabOffset = { x: event.clientX - rect.x, y: event.clientY - (rect.y + rect.height / 2) };
      target.setPointerCapture(event.pointerId);
      this.layer.classList.add('pe-handles-dragging');
      this.show();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!this.dragging) return;
      event.preventDefault();
      this.moveTo(event.clientX - this.grabOffset.x, event.clientY - this.grabOffset.y);
      this.updateAutoScroll(event.clientY);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!this.dragging) return;
      const target = event.target as HTMLElement;
      if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
      this.dragging = null;
      this.stopAutoScroll();
      this.layer.classList.remove('pe-handles-dragging');
      this.show();
    };

    this.layer.addEventListener('pointerdown', onPointerDown);
    this.layer.addEventListener('pointermove', onPointerMove);
    this.layer.addEventListener('pointerup', onPointerUp);
    this.layer.addEventListener('pointercancel', onPointerUp);
    this.disposers.push(() => {
      this.layer.removeEventListener('pointerdown', onPointerDown);
      this.layer.removeEventListener('pointermove', onPointerMove);
      this.layer.removeEventListener('pointerup', onPointerUp);
      this.layer.removeEventListener('pointercancel', onPointerUp);
    });

    this.disposers.push(this.editor.on('selection', () => this.show()));
    this.disposers.push(this.editor.on('scroll', () => this.update()));
    this.disposers.push(this.editor.on('focus', () => this.update()));
    this.disposers.push(this.editor.on('change', () => this.update()));
  }

  detach(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
    this.stopAutoScroll();
    this.layer.remove();
  }

  private anchorFor(kind: HandleKind): Position | null {
    const selection = this.editor.selection;
    if (kind === 'caret') return selectionIsEmpty(selection) ? selection.head : null;
    if (selectionIsEmpty(selection)) return null;
    return kind === 'start' ? selectionStart(selection) : selectionEnd(selection);
  }

  private moveTo(clientX: number, clientY: number): void {
    const editor = this.editor;
    const target = editor.positionAtClient(clientX, clientY);
    const selection = editor.selection;

    if (this.dragging === 'caret') {
      editor.setCaret(target, { scroll: false });
    } else if (this.dragging === 'start') {
      editor.setSelection({ anchor: selectionEnd(selection), head: target }, { scroll: false });
    } else {
      editor.setSelection({ anchor: selectionStart(selection), head: target }, { scroll: false });
    }
    this.onInteract();
  }

  /** Scroll when a drag reaches the top or bottom edge of the viewport. */
  private updateAutoScroll(clientY: number): void {
    const rect = this.editor.renderer.scroller.getBoundingClientRect();
    const zone = 48;
    let speed = 0;
    if (clientY < rect.top + zone) speed = -Math.ceil((rect.top + zone - clientY) / 6);
    else if (clientY > rect.bottom - zone) speed = Math.ceil((clientY - (rect.bottom - zone)) / 6);

    if (speed === 0) {
      this.stopAutoScroll();
      return;
    }
    if (this.autoScroll) return;

    const step = () => {
      if (!this.dragging) return;
      this.editor.renderer.scroller.scrollTop += speed;
      this.autoScroll = requestAnimationFrame(step);
    };
    this.autoScroll = requestAnimationFrame(step);
  }

  private stopAutoScroll(): void {
    if (this.autoScroll) cancelAnimationFrame(this.autoScroll);
    this.autoScroll = 0;
  }

  /** Make the handles visible and start the idle-hide timer. */
  show(): void {
    this.layer.classList.add('pe-handles-visible');
    this.update();
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (selectionIsEmpty(this.editor.selection)) {
      this.hideTimer = window.setTimeout(() => {
        this.layer.classList.remove('pe-handles-visible');
      }, 3200);
    }
  }

  update(): void {
    const editor = this.editor;
    const hostRect = editor.renderer.editor.getBoundingClientRect();
    const scrollRect = editor.renderer.scroller.getBoundingClientRect();
    const empty = selectionIsEmpty(editor.selection);

    const place = (kind: HandleKind, position: Position | null) => {
      const node = this.nodes[kind];
      if (!position || !editor.isFocused) {
        node.classList.remove('pe-handle-shown');
        return;
      }
      const rect = editor.caretClientRect(position);
      // Hide handles whose anchor has scrolled out of view.
      if (rect.y + rect.height < scrollRect.top || rect.y > scrollRect.bottom) {
        node.classList.remove('pe-handle-shown');
        return;
      }
      node.classList.add('pe-handle-shown');
      node.style.transform = `translate(${(rect.x - hostRect.left).toFixed(1)}px, ${(
        rect.y - hostRect.top + rect.height
      ).toFixed(1)}px)`;
    };

    place('caret', empty ? editor.selection.head : null);
    place('start', empty ? null : selectionStart(editor.selection));
    place('end', empty ? null : selectionEnd(editor.selection));
  }

  get isDragging(): boolean {
    return this.dragging !== null;
  }
}
