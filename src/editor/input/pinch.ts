import type { Editor } from '../core/editor.ts';
import type { Position } from '../model/position.ts';
import type { Cell } from '../view/metrics.ts';

const MIN_FONT_SIZE = 9;
const MAX_FONT_SIZE = 32;

interface Anchor {
  /** Finger separation when the gesture began. */
  distance: number;
  fontSize: number;
  /** The cell at that font size, the baseline every scale is measured against. */
  cell: Cell;
  /** Vertical pinch centre in the sizer's coordinates, for `transform-origin`. */
  originY: number;
  /** Horizontal scroll offset, which the gutter cancels out to stay on screen. */
  scrollLeft: number;
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
 * and no repaint, so the text tracks the fingers the way the browser's own page
 * zoom does. An earlier version instead recomputed the font size on every move,
 * which re-wrapped the whole document on every frame of a continuous gesture —
 * the wrong mechanism, not a slow one. When the fingers lift, the scale is
 * folded into a real font size and the document is laid out once, for real. The
 * blur of scaled-up text sharpens at that moment, which is the trade every map
 * and PDF viewer makes.
 *
 * Nothing changes size at that moment, though, and that is the part worth being
 * careful about. Two things had to give way for it. A font size is not a whole
 * number here — rounding it to one put a floor of three per cent under the
 * gesture, which is coarse enough to see. And the preview does not scale by the
 * finger ratio but by the ratio the chosen size *measures*, because a font's
 * advance is not exactly proportional to its size. What you pinch to is what
 * you get.
 *
 * Only the editor's contents scale — the toolbar, status bar and keyboard keep
 * their size, which is what page zoom cannot do.
 */
export class PinchZoom {
  private readonly editor: Editor;
  private anchor: Anchor | null = null;
  /** Font size the current finger separation corresponds to. */
  private size = 0;
  /** Cells measured at half-pixel font sizes, kept between gestures. */
  private cells = new Map<number, Cell>();
  private cellsFont = '';
  private disposers: (() => void)[] = [];

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /**
   * What the cell measures at `size`.
   *
   * Measuring on every touch move is a forced layout per frame — a millisecond
   * of the frame's budget to buy about a hundredth of a pixel, because the cell
   * is very nearly proportional to the font size. `line-height` here is a
   * unitless multiplier, so the height is proportional *exactly*, on every
   * device; only the advance width is subject to the font engine's hinting, and
   * only slightly. So measurements are taken at half-pixel steps and kept, and
   * sizes in between are scaled from the nearest one — which is exact
   * vertically and out by far less than a device pixel horizontally.
   */
  private cellAt(size: number): Cell {
    const step = Math.round(size * 2) / 2;
    let cell = this.cells.get(step);
    if (!cell) {
      cell = this.editor.metrics.cellAt(this.editor.renderer.measureProbe, step) ?? {
        charWidth: this.editor.metrics.charWidth,
        lineHeight: this.editor.metrics.lineHeight,
      };
      this.cells.set(step, cell);
    }
    const k = size / step;
    return { charWidth: cell.charWidth * k, lineHeight: cell.lineHeight * k };
  }

  /**
   * Throw the measurements away if they no longer describe the current font.
   * Checked once when the fingers land, never while they are moving.
   */
  private validateCells(): void {
    const font = getComputedStyle(this.editor.renderer.measureProbe).fontFamily;
    // A web font that loaded after the cache was built changes the numbers
    // without changing the family name, so one entry is checked against the
    // live cell as well.
    const stale =
      font !== this.cellsFont ||
      this.cells.size === 0 ||
      Math.abs(this.cellAt(this.editor.config.fontSize).charWidth - this.editor.metrics.charWidth) >
        0.05;
    if (!stale) return;
    this.cells.clear();
    this.cellsFont = font;
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
      this.validateCells();
      this.anchor = {
        distance: distanceBetween(event.touches),
        fontSize: this.editor.config.fontSize,
        cell: {
          charWidth: this.editor.metrics.charWidth,
          lineHeight: this.editor.metrics.lineHeight,
        },
        originY: centre.y - sizerRect.top,
        scrollLeft: scroller.scrollLeft,
        gutterWidth: this.editor.renderer.gutterWidth(
          this.editor.buffer.lineCount,
          this.editor.config.lineNumbers,
        ),
        position: this.editor.positionAtClient(centre.x, centre.y),
        clientX: centre.x,
        clientY: centre.y,
      };
      this.size = this.editor.config.fontSize;

      // Widen the painted band before anything moves. Shrinking the text brings
      // rows into view that were never painted, and there is no repaint during
      // the gesture to notice — the bottom of the screen would simply be empty.
      // The headroom asked for is exactly how far this gesture can shrink.
      this.editor.setZoomHeadroom(MIN_FONT_SIZE / this.editor.config.fontSize);

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

      const ratio = distanceBetween(event.touches) / anchor.distance;
      const size = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, anchor.fontSize * ratio));
      if (Math.abs(size - this.size) < 0.01) return;
      this.size = size;

      // Measured, not assumed: the font engine hints and rounds, so the real
      // advance at this size is not quite the old advance times the finger
      // ratio, and scaling by the real one is what makes the release invisible.
      const cell = this.cellAt(size);
      const scaleX = cell.charWidth / anchor.cell.charWidth;
      const scaleY = cell.lineHeight / anchor.cell.lineHeight;

      // The only writes in the whole gesture, and ones the compositor applies
      // without touching layout. The gutter keeps the horizontal offset the
      // renderer gave it — that is what holds it against the left edge of the
      // viewport when the text is scrolled sideways. The text is pushed right by
      // the gutter's growth so the two never overlap: the gutter's right edge
      // lands at `gutterWidth * scaleX`, which is where the text now starts.
      const shift = anchor.gutterWidth * (scaleX - 1);
      gutter.style.transform = `translateX(${anchor.scrollLeft}px) scale(${scaleX}, ${scaleY})`;
      content.style.transform = `translateX(${shift}px) scale(${scaleX}, ${scaleY})`;
    };

    const onTouchEnd = (event: TouchEvent) => {
      const anchor = this.anchor;
      if (!anchor || event.touches.length >= 2) return;

      const next = this.size;
      this.anchor = null;
      this.size = 0;
      for (const node of [gutter, content]) {
        node.style.transform = '';
        node.style.transformOrigin = '';
        node.style.willChange = '';
      }
      // The renderer caches the styles it writes; the gutter's transform was
      // just changed behind its back, so let it write that one again.
      this.editor.renderer.forgetStyle(gutter, 'transform');
      this.editor.setZoomHeadroom(null);

      if (Math.abs(next - this.editor.config.fontSize) < 0.01) return;

      // Now do it properly: a real font size, a real re-layout, sharp text.
      this.editor.setConfig({ fontSize: next });

      // Keep the line that was between the fingers between the fingers.
      const coords = this.editor.layout.coordsAt(anchor.position);
      const rect = scroller.getBoundingClientRect();
      scroller.scrollTop = Math.max(0, coords.y - (anchor.clientY - rect.top));
      if (!this.editor.config.wordWrap) {
        const gutterW = this.editor.renderer.gutterWidth(
          this.editor.buffer.lineCount,
          this.editor.config.lineNumbers,
        );
        scroller.scrollLeft = Math.max(0, coords.x + gutterW - (anchor.clientX - rect.left));
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
