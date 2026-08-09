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
    const sample = 'MMMMMMMMMMMMMMMMMMMM';
    probe.textContent = sample;
    const rect = probe.getBoundingClientRect();
    probe.textContent = '';

    const width = rect.width / sample.length;
    if (!(width > 0)) return false;

    const style = getComputedStyle(probe);
    const parsed = parseFloat(style.lineHeight);
    const raw = Number.isFinite(parsed) && parsed > 0 ? parsed : rect.height;

    // Rounded to whole pixels so every line lands on a device pixel boundary.
    // At a fractional line height the rows sit at 67.5px, 90px, 112.5px… and
    // text on a half-pixel has to be re-rasterised as it scrolls instead of
    // being moved by the compositor — which is what a stuttering flick is.
    const height = Math.max(1, Math.round(raw));

    // The character width is deliberately *not* rounded: it is the font's real
    // advance, and the layout uses it to place tabs and wide glyphs. Rounding
    // would make our arithmetic drift from what the browser paints, a little
    // more with every character on the line.
    const changed = Math.abs(width - this.charWidth) > 0.01 || height !== this.lineHeight;
    this.charWidth = width;
    this.lineHeight = height;
    return changed;
  }
}
