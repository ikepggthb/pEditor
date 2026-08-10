import type { Editor } from '../core/editor.ts';
import type { Position } from '../model/position.ts';

const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 32;

interface Anchor {
  distance: number;
  fontSize: number;
  /** The document position under the pinch centre when the gesture began. */
  position: Position;
  /** Where that position sat on screen, so it can be kept there. */
  clientY: number;
}

function distanceBetween(touches: TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function midpointOf(touches: TouchList): { x: number; y: number } {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

/**
 * Pinch to resize the text.
 *
 * A phone's default response to a pinch is to zoom the page, which scales the
 * chrome along with the code and leaves the layout wider than the screen. Here
 * the gesture changes the editor's font size instead: the character cell grows,
 * and because every measurement in the view derives from that cell, the gutter,
 * line spacing and wrap width all follow from the same number.
 *
 * `user-scalable=no` is not enough on its own — iOS Safari has ignored it since
 * iOS 10 — so the page-level gesture is cancelled explicitly.
 */
export class PinchZoom {
  private readonly editor: Editor;
  private anchor: Anchor | null = null;
  private pendingSize: number | null = null;
  private frame = 0;
  private disposers: (() => void)[] = [];

  constructor(editor: Editor) {
    this.editor = editor;
  }

  attach(): void {
    const scroller = this.editor.renderer.scroller;

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      // Deliberately no preventDefault, and registered as passive below. A
      // non-passive `touchstart` on the scroller forces the browser to run
      // this handler before it may scroll at all, because the handler might
      // cancel the gesture — which shows up as the view lagging behind your
      // finger. Nothing is lost: `touch-action: pan-x pan-y` on the scroller
      // already denies the browser its pinch-zoom, and Safari's own gesture
      // events are cancelled separately.
      const centre = midpointOf(event.touches);
      this.anchor = {
        distance: distanceBetween(event.touches),
        fontSize: this.editor.config.fontSize,
        position: this.editor.positionAtClient(centre.x, centre.y),
        clientY: centre.y,
      };
      // Attached only for the duration of the pinch. A permanently registered
      // non-passive `touchmove` would make every one-finger scroll wait on
      // JavaScript, and single-finger scrolling is the common case by far.
      scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!this.anchor || event.touches.length !== 2) return;
      event.preventDefault();

      const scale = distanceBetween(event.touches) / this.anchor.distance;
      // Whole pixels: the re-layout is not free, and a half-pixel of type size
      // is not a difference anyone is pinching for.
      const next = Math.round(
        Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, this.anchor.fontSize * scale)),
      );
      if (next === this.editor.config.fontSize) return;

      this.pendingSize = next;
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        const size = this.pendingSize;
        this.pendingSize = null;
        if (size !== null) this.applyFontSize(size);
      });
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length >= 2) return;
      this.anchor = null;
      scroller.removeEventListener('touchmove', onTouchMove);
    };

    // Safari's own pinch-zoom arrives as these, separately from touch events.
    const preventGesture = (event: Event) => event.preventDefault();

    scroller.addEventListener('touchstart', onTouchStart, { passive: true });
    scroller.addEventListener('touchend', onTouchEnd, { passive: true });
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: true });
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(type, preventGesture, { passive: false });
    }

    this.disposers.push(() => {
      scroller.removeEventListener('touchstart', onTouchStart);
      scroller.removeEventListener('touchmove', onTouchMove);
      scroller.removeEventListener('touchend', onTouchEnd);
      scroller.removeEventListener('touchcancel', onTouchEnd);
      for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
        document.removeEventListener(type, preventGesture);
      }
    });
  }

  detach(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
  }

  /**
   * Resize, then scroll so the line under the fingers stays under the fingers.
   * Without this the text slides away as it grows and the pinch feels like it
   * is happening to some other part of the document.
   */
  private applyFontSize(size: number): void {
    const anchor = this.anchor;
    this.editor.setConfig({ fontSize: size });
    if (!anchor) return;

    const scroller = this.editor.renderer.scroller;
    const coords = this.editor.layout.coordsAt(anchor.position);
    const offsetInViewport = anchor.clientY - scroller.getBoundingClientRect().top;
    scroller.scrollTop = Math.max(0, coords.y - offsetInViewport);
  }
}
