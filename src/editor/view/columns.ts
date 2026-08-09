/**
 * Visual column arithmetic.
 *
 * Two things make a column not equal to a string index: tabs, which jump to the
 * next tab stop, and East Asian wide characters, which occupy two cells in a
 * monospace font. Both matter here — a phone editor that misplaces the caret in
 * Japanese comments is a phone editor nobody uses.
 */

/**
 * Ranges from Unicode East Asian Width (W and F classes). Characters in these
 * ranges render at exactly two cells in every monospace font worth using.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, Hangul Compatibility Jamo, CJK compat
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK Compatibility Forms
  [0xff00, 0xff60], // Fullwidth Forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1f64f], // Emoji
  [0x1f900, 0x1f9ff], // Supplemental symbols and pictographs
  [0x20000, 0x2fffd], // CJK Extension B+
  [0x30000, 0x3fffd],
];

export function isWideCodePoint(cp: number): boolean {
  if (cp < 0x1100) return false;
  for (const [lo, hi] of WIDE_RANGES) {
    if (cp < lo) return false;
    if (cp <= hi) return true;
  }
  return false;
}

/** True when every character is a plain single-width ASCII cell (tabs allowed). */
export function isSimpleAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      if (code !== 0x09) return false;
    }
  }
  return true;
}

/**
 * Column of every string index in `text`, as `out[i]` for index `i`, with one
 * extra entry for the end of the line.
 */
export function columnMap(text: string, tabSize: number): Int32Array {
  const out = new Int32Array(text.length + 1);
  let col = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i) as number;
    const units = cp > 0xffff ? 2 : 1;
    const width = cp === 9 ? tabSize - (col % tabSize) : isWideCodePoint(cp) ? 2 : 1;
    col += width;
    // Both halves of a surrogate pair report the column *after* the glyph; the
    // caret can never sit between them, so the intermediate value is unused.
    for (let k = 1; k <= units; k++) out[i + k] = col;
    i += units;
  }
  return out;
}

/** Column at a single index, without allocating a map. */
export function columnAt(text: string, index: number, tabSize: number): number {
  let col = 0;
  let i = 0;
  const limit = Math.min(index, text.length);
  while (i < limit) {
    const cp = text.codePointAt(i) as number;
    const units = cp > 0xffff ? 2 : 1;
    col += cp === 9 ? tabSize - (col % tabSize) : isWideCodePoint(cp) ? 2 : 1;
    i += units;
  }
  return col;
}

/** Total width of a line in columns. */
export function lineColumns(text: string, tabSize: number): number {
  return columnAt(text, text.length, tabSize);
}

/**
 * The string index nearest to `column`.
 *
 * Rounds to whichever character boundary is closer, which is what makes tapping
 * near the middle of a wide glyph land on the side you aimed at.
 */
export function indexAtColumn(text: string, column: number, tabSize: number): number {
  if (column <= 0) return 0;
  let col = 0;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i) as number;
    const units = cp > 0xffff ? 2 : 1;
    const width = cp === 9 ? tabSize - (col % tabSize) : isWideCodePoint(cp) ? 2 : 1;
    const next = col + width;
    if (column < next) {
      // Inside this glyph — snap to the nearer edge.
      return column - col >= width / 2 ? i + units : i;
    }
    col = next;
    i += units;
  }
  return text.length;
}

/** Width, in columns, that a tab at `column` will occupy. */
export function tabWidthAt(column: number, tabSize: number): number {
  return tabSize - (column % tabSize);
}
