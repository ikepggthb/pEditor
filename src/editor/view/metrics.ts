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
    const height = Number.isFinite(parsed) && parsed > 0 ? parsed : rect.height;

    const changed = Math.abs(width - this.charWidth) > 0.01 || Math.abs(height - this.lineHeight) > 0.01;
    this.charWidth = width;
    this.lineHeight = height;
    return changed;
  }
}
