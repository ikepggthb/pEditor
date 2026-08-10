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
  /** What each candidate font size measures, so the preview can match it exactly. */
  sizes: Map<number, Cell>;
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
 * and no repaint, so the text tracks the fingers exactly the way the browser's
 * own page zoom does. An earlier version instead recomputed the font size on
 * every move — but a font size is a whole number of pixels, so the text could
 * only jump between discrete steps, each one re-wrapping the document. No
 * amount of optimisation makes that feel continuous; it was the wrong
 * mechanism, not a slow one.
 *
 * The scale is not the raw finger ratio, though. It is snapped to the nearest
 * scale a font size can actually produce, measured beforehand rather than
 * assumed: the preview therefore shows the size that will be applied, and
 * nothing changes size when the fingers lift. Only the sharpness does, when the
 * scale is folded into a real font size and the document is laid out again for
 * real — the same trade every map and PDF viewer makes.
 *
 * Only the editor's contents scale — the toolbar, status bar and keyboard keep
 * their size, which is what page zoom cannot do.
 */
export class PinchZoom {
  private readonly editor: Editor;
  private anchor: Anchor | null = null;
  /** Font size the current finger separation corresponds to. */
  private size = 0;
  private sizes: Map<number, Cell> | null = null;
  private sizesFont = '';
  private disposers: (() => void)[] = [];

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /**
   * What every font size in range measures, built once and reused.
   *
   * Twenty-four probe measurements is more than one wants on a touch frame, so
   * it happens when the fingers land — before anything is moving — and is kept
   * until the font itself changes.
   */
  private measureSizes(): Map<number, Cell> {
    const probe = this.editor.renderer.measureProbe;
    const font = getComputedStyle(probe).fontFamily;
    // A web font that finished loading changes the measurements without
    // changing the family name, so the live cell is checked too.
    const live = this.sizes?.get(this.editor.config.fontSize);
    if (this.sizes && this.sizesFont === font && live && live.lineHeight === this.editor.metrics.lineHeight) {
      return this.sizes;
    }

    const sizes = new Map<number, Cell>();
    for (let size = MIN_FONT_SIZE; size <= MAX_FONT_SIZE; size++) {
      const cell = this.editor.metrics.cellAt(probe, size);
      if (cell) sizes.set(size, cell);
    }
    this.sizes = sizes;
    this.sizesFont = font;
    return sizes;
  }

  /** The font size whose line height comes closest to `scale` times the anchor's. */
  private sizeFor(anchor: Anchor, scale: number): number {
    const targetHeight = anchor.cell.lineHeight * scale;
    const targetWidth = anchor.cell.charWidth * scale;
    let best = anchor.fontSize;
    let bestError = Infinity;
    for (const [size, cell] of anchor.sizes) {
      // Line height first: it is what the eye reads as "the text got bigger",
      // and it is the coarser of the two, so it decides. Character width breaks
      // the ties two sizes that round to the same height would otherwise leave.
      const error =
        Math.abs(cell.lineHeight - targetHeight) + Math.abs(cell.charWidth - targetWidth) / 1000;
      if (error < bestError) {
        bestError = error;
        best = size;
      }
    }
    return best;
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
      const fontSize = this.editor.config.fontSize;
      const sizes = this.measureSizes();
      this.anchor = {
        distance: distanceBetween(event.touches),
        fontSize,
        cell: sizes.get(fontSize) ?? {
          charWidth: this.editor.metrics.charWidth,
          lineHeight: this.editor.metrics.lineHeight,
        },
        sizes,
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
      this.size = fontSize;

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

      const size = this.sizeFor(anchor, distanceBetween(event.touches) / anchor.distance);
      if (size === this.size) return;
      this.size = size;

      // Not the finger ratio but the ratio the chosen font size really measures,
      // and separately per axis: the line height is rounded to whole pixels and
      // the advance width is not, so a single number cannot describe both. Using
      // the real ones is what makes the preview and the result the same size.
      const cell = anchor.sizes.get(size) ?? anchor.cell;
      const scaleX = cell.charWidth / anchor.cell.charWidth;
      const scaleY = cell.lineHeight / anchor.cell.lineHeight;

      // The only writes in the whole gesture, and ones the compositor applies
      // without touching layout. The gutter keeps the horizontal offset the
      // renderer gave it — that is what holds it against the left edge of the
      // viewport when the text is scrolled sideways; dropping it here sent the
      // line numbers off the screen. The text is pushed right by the gutter's
      // growth so the two never overlap: the gutter's right edge lands at
      // `gutterWidth * scaleX`, which is exactly where the text now starts.
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

      if (next === this.editor.config.fontSize) return;

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
