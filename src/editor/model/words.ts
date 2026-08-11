/**
 * Word boundaries.
 *
 * Double-tap-to-select-word is the main way you select anything on a phone, so
 * the categories matter more here than on desktop. Text is classified into
 * word / space / punctuation, and a "word" is a run of one category. CJK is
 * treated as its own category so double-tapping Japanese text selects the run
 * of kana or kanji rather than the entire line.
 */
export type CharCategory = 'word' | 'space' | 'punct' | 'cjk';

const WORD_RE = /[\p{L}\p{N}_$]/u;
const SPACE_RE = /\s/;
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/u;

export function categoryOf(ch: string): CharCategory {
  if (SPACE_RE.test(ch)) return 'space';
  if (CJK_RE.test(ch)) return 'cjk';
  if (WORD_RE.test(ch)) return 'word';
  return 'punct';
}

/**
 * The run of same-category characters containing `ch`.
 *
 * When the index sits on a boundary the character to the left wins, matching
 * what people expect when they tap just past the end of a word.
 */
export function wordBoundsAt(text: string, ch: number): { start: number; end: number } {
  if (text.length === 0) return { start: 0, end: 0 };

  const index = Math.max(0, Math.min(ch, text.length));
  let probe = index;
  if (probe >= text.length) probe = text.length - 1;
  else if (probe > 0 && categoryOf(text[probe]) === 'space' && categoryOf(text[probe - 1]) !== 'space') {
    probe -= 1;
  }

  const category = categoryOf(text[probe]);
  let start = probe;
  let end = probe + 1;
  while (start > 0 && categoryOf(text[start - 1]) === category) start--;
  while (end < text.length && categoryOf(text[end]) === category) end++;
  return { start, end };
}

/**
 * The index a ctrl/alt-arrow word jump should land on.
 *
 * Skips any leading whitespace in the direction of travel, then consumes one
 * run of a single category — so it stops at the far side of a word rather than
 * inside it.
 */
export function nextWordBoundary(text: string, ch: number, dir: 1 | -1): number {
  let i = ch;
  if (dir === 1) {
    while (i < text.length && categoryOf(text[i]) === 'space') i++;
    if (i >= text.length) return text.length;
    const category = categoryOf(text[i]);
    while (i < text.length && categoryOf(text[i]) === category) i++;
    return i;
  }

  while (i > 0 && categoryOf(text[i - 1]) === 'space') i--;
  if (i <= 0) return 0;
  const category = categoryOf(text[i - 1]);
  while (i > 0 && categoryOf(text[i - 1]) === category) i--;
  return i;
}

/** Index of the first non-whitespace character, or the line length if blank. */
export function firstNonWhitespace(text: string): number {
  // A loop rather than `/\S/.exec`, which allocates a match object per call —
  // and this is called for every line of the document when the wrap changes.
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code !== 32 && code !== 9 && !(code >= 0x0b && code <= 0x0d) && code !== 0xa0) return i;
  }
  return text.length;
}
