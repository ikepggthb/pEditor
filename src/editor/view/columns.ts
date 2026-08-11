/**
 * Visual column arithmetic.
 *
 * Three things make a column not equal to a string index: tabs, which jump to
 * the next tab stop; East Asian wide characters, which occupy two cells in a
 * monospace font; and grapheme clusters, where several code points paint as one
 * glyph. All three matter here — a phone editor that misplaces the caret in
 * Japanese comments is a phone editor nobody uses, and one that cuts an emoji
 * into its parts is worse.
 */

/**
 * Ranges from Unicode East Asian Width (W and F classes), plus the emoji blocks
 * that render at two cells whatever their formal width. Characters in these
 * ranges take two cells in every monospace font worth using.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x231a, 0x231b], // watch, hourglass
  [0x23e9, 0x23ec], // media controls
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653], // zodiac
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
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
  [0x1f004, 0x1f004], // mahjong red dragon
  [0x1f0cf, 0x1f0cf], // joker
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f2ff], // enclosed ideographic supplement
  [0x1f300, 0x1f6ff], // pictographs, emoticons, transport — the bulk of emoji
  [0x1f7e0, 0x1f7eb], // coloured shapes
  [0x1f900, 0x1f9ff], // supplemental symbols and pictographs
  [0x1fa70, 0x1faff], // symbols and pictographs extended-A
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

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * Whether a code unit can be part of something longer than one code point.
 *
 * Grapheme segmentation is correct but two orders of magnitude slower than
 * walking code points, and most lines contain nothing that can combine: ASCII
 * cannot, and neither can plain kanji or kana. This is the test that keeps
 * those lines on the cheap path, so the expensive one only runs where it
 * changes the answer.
 */
function mayCombine(code: number): boolean {
  if (code < 0x0300) return false;
  // Combining marks, and the scripts written with them: Greek through Hangul
  // Jamo, plus the standalone joiners and selectors above that.
  if (code <= 0x1dff) return true;
  if (code === 0x200d) return true; // zero-width joiner, which builds emoji
  if (code >= 0x20d0 && code <= 0x20ff) return true; // combining marks for symbols
  if (code >= 0x3099 && code <= 0x309a) return true; // kana voiced marks
  if (code >= 0xfe00 && code <= 0xfe2f) return true; // variation selectors, half marks
  return code >= 0xd800 && code <= 0xdfff; // any astral character, emoji included
}

function needsSegmentation(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (mayCombine(text.charCodeAt(i))) return true;
  }
  return false;
}

/**
 * End index of the cluster beginning at each index, or `null` when every
 * cluster in the line is a single code point and plain arithmetic will do.
 *
 * Computed once per line and passed down, because segmenting is the expensive
 * part and every consumer wants the same answer.
 */
export function clusterEnds(text: string): Int32Array | null {
  if (!segmenter || !needsSegmentation(text)) return null;
  const ends = new Int32Array(text.length);
  for (const { index, segment } of segmenter.segment(text)) {
    ends[index] = index + segment.length;
  }
  return ends;
}

/** Where the cluster starting at `index` ends. */
export function endOfCluster(text: string, index: number, ends: Int32Array | null): number {
  if (ends) {
    const end = ends[index];
    if (end > index) return end;
  }
  const cp = text.codePointAt(index) as number;
  return index + (cp > 0xffff ? 2 : 1);
}

/**
 * How many cells one cluster occupies.
 *
 * A cluster is as wide as its base character, with two exceptions that only
 * arise once code points combine: an emoji presentation selector turns an
 * otherwise narrow symbol into a full emoji (`❤` is one cell, `❤️` is two),
 * and a pair of regional indicators is a flag rather than two letters.
 */
export function clusterWidth(
  text: string,
  start: number,
  end: number,
  tabSize: number,
  column: number,
): number {
  const cp = text.codePointAt(start) as number;
  if (cp === 9) return tabSize - (column % tabSize);
  if (end - start > 1) {
    for (let i = start; i < end; i++) {
      if (text.charCodeAt(i) === 0xfe0f) return 2;
    }
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return 2;
  }
  return isWideCodePoint(cp) ? 2 : 1;
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
  const ends = clusterEnds(text);
  let col = 0;
  let i = 0;
  while (i < text.length) {
    const end = endOfCluster(text, i, ends);
    col += clusterWidth(text, i, end, tabSize, col);
    // Every index inside a cluster reports the column *after* the glyph; the
    // caret can never sit between the parts, so the interior values are unused.
    for (let k = i + 1; k <= end; k++) out[k] = col;
    i = end;
  }
  return out;
}

/** Column at a single index, without keeping the map. */
export function columnAt(text: string, index: number, tabSize: number): number {
  const ends = clusterEnds(text);
  const limit = Math.min(index, text.length);
  let col = 0;
  let i = 0;
  while (i < limit) {
    const end = endOfCluster(text, i, ends);
    col += clusterWidth(text, i, end, tabSize, col);
    i = end;
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
 * Rounds to whichever cluster boundary is closer, which is what makes tapping
 * near the middle of a wide glyph land on the side you aimed at.
 */
export function indexAtColumn(text: string, column: number, tabSize: number): number {
  if (column <= 0) return 0;
  const ends = clusterEnds(text);
  let col = 0;
  let i = 0;
  while (i < text.length) {
    const end = endOfCluster(text, i, ends);
    const width = clusterWidth(text, i, end, tabSize, col);
    const next = col + width;
    if (column < next) {
      // Inside this glyph — snap to the nearer edge.
      return column - col >= width / 2 ? end : i;
    }
    col = next;
    i = end;
  }
  return text.length;
}

/**
 * One cluster forwards or backwards from `index`.
 *
 * This is what the caret and backspace move by. Stepping a code point at a time
 * would leave the caret between the halves of an emoji, and backspace would
 * strip a skin tone or a joiner and leave the wreckage behind.
 */
export function stepIndex(text: string, index: number, dir: 1 | -1): number {
  const ends = clusterEnds(text);
  if (dir === 1) {
    if (index >= text.length) return text.length;
    return Math.min(endOfCluster(text, index, ends), text.length);
  }
  if (index <= 0) return 0;
  let start = 0;
  let i = 0;
  while (i < index) {
    start = i;
    i = endOfCluster(text, i, ends);
  }
  return start;
}

/** Width, in columns, that a tab at `column` will occupy. */
export function tabWidthAt(column: number, tabSize: number): number {
  return tabSize - (column % tabSize);
}
