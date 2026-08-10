import type { Editor } from '../core/editor.ts';
import type { Position } from '../model/position.ts';

const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 32;

interface Anchor {
  /** Finger separation when the gesture began. */
  distance: number;
  fontSize: number;
  /** Vertical pinch centre in the sizer's coordinates, for `transform-origin`. */
  originY: number;
  /** Gutter width at the start, needed to keep the text beside it as it grows. */
  gutterWidth: number;
  /** The document position under the pinch centre, and where it sat on screen. */
  position: Position;
  clientX: number;
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
 * The gesture has two halves, and getting the split right is the whole point.
 *
 * While the fingers are down, the editor's contents are scaled with a CSS
 * `transform`. That is a compositor property: it costs no layout, no restyle
 * and no repaint, so the text tracks the fingers exactly the way the browser's
 * own page zoom does. An earlier version instead recomputed the font size on
 * every move — but a font size is a whole number of pixels, so the text could
 * only jump between discrete steps, each one re-wrapping the document. No
 * amount of optimisation makes that feel continuous; it was the wrong
 * mechanism, not a slow one.
 *
 * When the fingers lift, the scale is folded into a real font size and the
 * document is laid out again for real. The blur of scaled-up text sharpens at
 * that moment, which is the same trade every map and PDF viewer makes.
 *
 * Only the editor's contents scale — the toolbar, status bar and keyboard keep
 * their size, which is what page zoom cannot do.
 */
export class PinchZoom {
  private readonly editor: Editor;
  private anchor: Anchor | null = null;
  private scale = 1;
  private disposers: (() => void)[] = [];

  constructor(editor: Editor) {
    this.editor = editor;
  }

  attach(): void {
    const scroller = this.editor.renderer.scroller;
    const sizer = this.editor.renderer.sizer;
    const gutter = this.editor.renderer.gutter;
    const content = this.editor.renderer.content;

    const onTouchStart = (event: TouchEvent) => {
      // One finger is a scroll and belongs to the browser: leave immediately,
      // and above all do not cancel it.
      if (event.touches.length !== 2) return;

      // Two fingers make the gesture ours. Without this the browser treats it
      // as a two-finger pan and stops delivering moves after the first one.
      event.preventDefault();

      const centre = midpointOf(event.touches);
      const sizerRect = sizer.getBoundingClientRect();
      this.anchor = {
        distance: distanceBetween(event.touches),
        fontSize: this.editor.config.fontSize,
        originY: centre.y - sizerRect.top,
        gutterWidth: this.editor.renderer.gutterWidth(
          this.editor.buffer.lineCount,
          this.editor.config.lineNumbers,
        ),
        position: this.editor.positionAtClient(centre.x, centre.y),
        clientX: centre.x,
        clientY: centre.y,
      };
      this.scale = 1;

      // Scaled separately, and both anchored to x = 0 rather than to the pinch
      // centre. Scaling the whole sizer about the fingers is simpler, but it
      // drags the gutter's left edge off the side of the screen — the line
      // numbers slide away instead of growing in place. Pinned at the left they
      // grow like everything else, and the two stay in step vertically because
      // they share the same vertical origin.
      const origin = `0px ${this.anchor.originY}px`;
      gutter.style.transformOrigin = origin;
      content.style.transformOrigin = origin;
      gutter.style.willChange = 'transform';
      content.style.willChange = 'transform';
    };

    const onTouchMove = (event: TouchEvent) => {
      const anchor = this.anchor;
      if (!anchor || event.touches.length !== 2) return;
      event.preventDefault();

      // Clamped in scale space so the gesture stops at the same place the font
      // size would, instead of scaling past it and snapping back on release.
      const raw = distanceBetween(event.touches) / anchor.distance;
      const min = MIN_FONT_SIZE / anchor.fontSize;
      const max = MAX_FONT_SIZE / anchor.fontSize;
      this.scale = Math.max(min, Math.min(max, raw));

      // The only writes in the whole gesture, and ones the compositor applies
      // without touching layout. The text is pushed right by the gutter's
      // growth so the two never overlap: the gutter's right edge lands at
      // `gutterWidth * scale`, which is exactly where the text now starts.
      const shift = anchor.gutterWidth * (this.scale - 1);
      gutter.style.transform = `scale(${this.scale})`;
      content.style.transform = `translateX(${shift}px) scale(${this.scale})`;
    };

    const onTouchEnd = (event: TouchEvent) => {
      const anchor = this.anchor;
      if (!anchor || event.touches.length >= 2) return;

      const scale = this.scale;
      this.anchor = null;
      this.scale = 1;
      for (const node of [gutter, content]) {
        node.style.transform = '';
        node.style.transformOrigin = '';
        node.style.willChange = '';
      }
      // The renderer caches the styles it writes; the gutter's transform was
      // just changed behind its back, so let it write that one again.
      this.editor.renderer.forgetStyle(gutter, 'transform');

      const next = Math.round(anchor.fontSize * scale);
      if (next === this.editor.config.fontSize) return;

      // Now do it properly: a real font size, a real re-layout, sharp text.
      this.editor.setConfig({ fontSize: next });

      // Keep the line that was between the fingers between the fingers.
      const coords = this.editor.layout.coordsAt(anchor.position);
      const rect = scroller.getBoundingClientRect();
      scroller.scrollTop = Math.max(0, coords.y - (anchor.clientY - rect.top));
      if (!this.editor.config.wordWrap) {
        const gutter = this.editor.renderer.gutterWidth(
          this.editor.buffer.lineCount,
          this.editor.config.lineNumbers,
        );
        scroller.scrollLeft = Math.max(0, coords.x + gutter - (anchor.clientX - rect.left));
      }
    };

    // Safari's own pinch-zoom arrives as these, separately from touch events.
    const preventGesture = (event: Event) => event.preventDefault();

    scroller.addEventListener('touchstart', onTouchStart, { passive: false });
    scroller.addEventListener('touchmove', onTouchMove, { passive: false });
    scroller.addEventListener('touchend', onTouchEnd);
    scroller.addEventListener('touchcancel', onTouchEnd);
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
    for (const dispose of this.disposers) dispose();
    this.disposers = [];
  }
}
