import type { Editor } from '../core/editor.ts';
import { selectLineAt, selectWordAt } from '../core/commands.ts';
import type { TextInput } from './textInput.ts';
import type { SelectionHandles } from './handles.ts';

const TAP_SLOP = 10;
const TAP_MS = 400;
const MULTI_TAP_MS = 320;
const LONG_PRESS_MS = 450;

/**
 * Touch and mouse gestures over the text.
 *
 * Vertical panning is deliberately left to the browser's native scrolling —
 * momentum and rubber-banding are things a hand-rolled scroller never gets
 * right, and on a phone they are most of the feel of the app. This layer only
 * claims taps, long presses, and mouse drags.
 */
export class PointerInput {
  private downAt = { x: 0, y: 0, time: 0 };
  private activePointer: number | null = null;
  private moved = false;
  private longPressTimer: number | null = null;
  private tapCount = 0;
  private lastTapTime = 0;
  private lastTapAt = { x: 0, y: 0 };
  private mouseSelecting = false;
  private disposers: (() => void)[] = [];

  private readonly editor: Editor;
  private readonly input: TextInput;
  private readonly handles: SelectionHandles;

  constructor(editor: Editor, input: TextInput, handles: SelectionHandles) {
    this.editor = editor;
    this.input = input;
    this.handles = handles;
  }

  attach(): void {
    const scroller = this.editor.renderer.scroller;

    const onPointerDown = (event: PointerEvent) => {
      if (this.handles.isDragging) return;
      if ((event.target as HTMLElement).closest('.pe-handle')) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      this.activePointer = event.pointerId;
      this.downAt = { x: event.clientX, y: event.clientY, time: Date.now() };
      this.moved = false;

      if (event.pointerType === 'mouse') {
        this.mouseSelecting = true;
        const position = this.editor.positionAtClient(event.clientX, event.clientY);
        // `detail` is the native click count, so double- and triple-click get
        // the same word/line selection that double- and triple-tap do.
        if (event.detail >= 3) selectLineAt(this.editor, position.line);
        else if (event.detail === 2) selectWordAt(this.editor, position);
        else this.editor.setCaret(position, { scroll: false });
        this.input.focus();
      } else {
        this.longPressTimer = window.setTimeout(() => this.onLongPress(), LONG_PRESS_MS);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (this.activePointer !== event.pointerId) return;
      const dx = event.clientX - this.downAt.x;
      const dy = event.clientY - this.downAt.y;
      if (Math.hypot(dx, dy) > TAP_SLOP) {
        this.moved = true;
        this.clearLongPress();
      }
      if (this.mouseSelecting && this.moved) {
        const position = this.editor.positionAtClient(event.clientX, event.clientY);
        this.editor.setSelection({ anchor: this.editor.selection.anchor, head: position }, { scroll: false });
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (this.activePointer !== event.pointerId) return;
      this.clearLongPress();
      this.activePointer = null;
      this.mouseSelecting = false;

      const elapsed = Date.now() - this.downAt.time;
      if (this.moved || elapsed > TAP_MS) {
        if (!this.moved) this.handles.show();
        return;
      }
      if (event.pointerType !== 'mouse') this.onTap(event.clientX, event.clientY);
    };

    const onPointerCancel = () => {
      this.clearLongPress();
      this.activePointer = null;
      this.mouseSelecting = false;
    };

    // Suppress the iOS long-press callout without blocking scrolling.
    const onContextMenu = (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.closest('.pe-content')) event.preventDefault();
    };

    /**
     * Touch screens emit compatibility mouse events after `touchend`, and the
     * browser's default `mousedown` handling moves focus to whatever was
     * clicked — which here is a plain <div>, so it blurs the hidden textarea
     * and closes the keyboard a moment after every tap. Suppressing the default
     * keeps focus where the tap handler put it; scrolling is unaffected because
     * that is driven by the touch events, not these.
     */
    const onMouseDown = (event: MouseEvent) => event.preventDefault();

    scroller.addEventListener('mousedown', onMouseDown);
    scroller.addEventListener('pointerdown', onPointerDown);
    scroller.addEventListener('pointermove', onPointerMove);
    scroller.addEventListener('pointerup', onPointerUp);
    scroller.addEventListener('pointercancel', onPointerCancel);
    scroller.addEventListener('contextmenu', onContextMenu);

    this.disposers.push(() => {
      scroller.removeEventListener('mousedown', onMouseDown);
      scroller.removeEventListener('pointerdown', onPointerDown);
      scroller.removeEventListener('pointermove', onPointerMove);
      scroller.removeEventListener('pointerup', onPointerUp);
      scroller.removeEventListener('pointercancel', onPointerCancel);
      scroller.removeEventListener('contextmenu', onContextMenu);
    });
  }

  detach(): void {
    this.clearLongPress();
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private onTap(clientX: number, clientY: number): void {
    const now = Date.now();
    const near = Math.hypot(clientX - this.lastTapAt.x, clientY - this.lastTapAt.y) < 24;
    this.tapCount = near && now - this.lastTapTime < MULTI_TAP_MS ? this.tapCount + 1 : 1;
    this.lastTapTime = now;
    this.lastTapAt = { x: clientX, y: clientY };

    const position = this.editor.positionAtClient(clientX, clientY);
    if (this.tapCount >= 3) selectLineAt(this.editor, position.line);
    else if (this.tapCount === 2) selectWordAt(this.editor, position);
    else this.editor.setCaret(position, { scroll: false });

    this.input.focus();
    this.handles.show();
  }

  private onLongPress(): void {
    this.longPressTimer = null;
    if (this.moved) return;

    const position = this.editor.positionAtClient(this.downAt.x, this.downAt.y);
    selectWordAt(this.editor, position);
    this.input.focus();
    this.handles.show();
    navigator.vibrate?.(8);
  }
}
