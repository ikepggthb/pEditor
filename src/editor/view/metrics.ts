/** One character cell: the unit the whole view is measured in. */
export interface Cell {
  charWidth: number;
  lineHeight: number;
}

/**
 * Measure the cell the probe currently produces, or `null` if the probe is not
 * laid out yet (detached, or the font has not loaded).
 */
function sample(probe: HTMLElement): Cell | null {
  const text = 'MMMMMMMMMMMMMMMMMMMM';
  probe.textContent = text;
  const rect = probe.getBoundingClientRect();
  probe.textContent = '';

  const charWidth = rect.width / text.length;
  if (!(charWidth > 0)) return null;

  const parsed = parseFloat(getComputedStyle(probe).lineHeight);
  const raw = Number.isFinite(parsed) && parsed > 0 ? parsed : rect.height;

  // Rounded to whole pixels so every line lands on a device pixel boundary.
  // At a fractional line height the rows sit at 67.5px, 90px, 112.5px… and
  // text on a half-pixel has to be re-rasterised as it scrolls instead of
  // being moved by the compositor — which is what a stuttering flick is.
  //
  // The character width is deliberately *not* rounded: it is the font's real
  // advance, and the layout uses it to place tabs and wide glyphs. Rounding
  // would make our arithmetic drift from what the browser paints, a little
  // more with every character on the line.
  return { charWidth, lineHeight: Math.max(1, Math.round(raw)) };
}

/**
 * Character cell measurements.
 *
 * The whole view is built on one assumption: every cell is `charWidth` wide and
 * `lineHeight` tall. The renderer guarantees it holds even for CJK and tabs by
 * giving those characters explicit inline-block widths, so this stays true for
 * any font the user picks and all position maths can be plain arithmetic.
 */
export class Metrics {
  charWidth = 8;
  lineHeight = 20;

  /** Measure against a probe element that has the editor's real font applied. */
  measure(probe: HTMLElement): boolean {
    const cell = sample(probe);
    if (!cell) return false;

    const changed =
      Math.abs(cell.charWidth - this.charWidth) > 0.01 || cell.lineHeight !== this.lineHeight;
    this.charWidth = cell.charWidth;
    this.lineHeight = cell.lineHeight;
    return changed;
  }

  /**
   * The cell the editor *would* have at `fontSize`, without adopting it.
   *
   * Pinch-zoom needs this: it has to know what a font size will actually
   * produce before committing to it, because a font's advance is not exactly
   * proportional to its size and the line height is rounded to whole pixels.
   * Guessing instead means the text changes size the moment the fingers lift.
   */
  cellAt(probe: HTMLElement, fontSize: number): Cell | null {
    const previous = probe.style.fontSize;
    probe.style.fontSize = `${fontSize}px`;
    const cell = sample(probe);
    probe.style.fontSize = previous;
    return cell;
  }
}
