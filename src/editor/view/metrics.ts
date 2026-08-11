/** One character cell: the unit the whole view is measured in. */
export interface Cell {
  charWidth: number;
  lineHeight: number;
}

/**
 * Measure the cell the probe currently produces, or `null` if the probe is not
 * laid out yet (detached, or the font has not loaded).
 *
 * Neither number is rounded. They are the font's real advance and the real line
 * box, and the layout places tabs and wide glyphs by them — rounding would make
 * our arithmetic drift from what the browser paints, a little more with every
 * character on the line. It would also put a floor on how finely the text can
 * be resized, and that floor is exactly what a pinch runs into.
 */
function sample(probe: HTMLElement): Cell | null {
  const text = 'MMMMMMMMMMMMMMMMMMMM';
  probe.textContent = text;
  const rect = probe.getBoundingClientRect();
  probe.textContent = '';

  const charWidth = rect.width / text.length;
  if (!(charWidth > 0)) return null;

  const parsed = parseFloat(getComputedStyle(probe).lineHeight);
  const lineHeight = Number.isFinite(parsed) && parsed > 0 ? parsed : rect.height;
  return { charWidth, lineHeight: Math.max(1, lineHeight) };
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
      Math.abs(cell.charWidth - this.charWidth) > 0.01 ||
      Math.abs(cell.lineHeight - this.lineHeight) > 0.01;
    this.charWidth = cell.charWidth;
    this.lineHeight = cell.lineHeight;
    return changed;
  }

  /**
   * The cell the editor *would* have at `fontSize`, without adopting it.
   *
   * Pinch-zoom needs this: it has to know what a size will actually produce
   * before committing to it, because a font's advance is not exactly
   * proportional to its size — the font engine rounds and hints. Scaling by the
   * assumed ratio rather than the measured one is what makes text change size
   * the moment the fingers lift.
   */
  cellAt(probe: HTMLElement, fontSize: number): Cell | null {
    const previous = probe.style.fontSize;
    probe.style.fontSize = `${fontSize}px`;
    const cell = sample(probe);
    probe.style.fontSize = previous;
    return cell;
  }
}
