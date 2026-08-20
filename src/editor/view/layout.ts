import type { TextBuffer } from '../model/textBuffer.ts';
import { type Position, pos } from '../model/position.ts';
import {
  clusterEnds,
  clusterWidth,
  columnMap,
  endOfCluster,
  isWideCodePoint,
  lineColumns,
} from './columns.ts';
import { firstNonWhitespace } from '../model/words.ts';
import { smartWrap } from './smartWrap.ts';
import type { Metrics } from './metrics.ts';

/** How one document line is broken into visual rows. */
export interface LineLayout {
  /** String index where each visual row begins. Always starts with 0. */
  readonly rowStarts: number[];
  /** Column each visual row is indented by (row 0 is never indented). */
  readonly rowIndent: number[];
  /** Column of every string index, plus one entry for end-of-line. */
  readonly columns: Int32Array;
  /** Total width of the line in columns. */
  readonly width: number;
}

export interface LayoutOptions {
  tabSize: number;
  wordWrap: boolean;
  /** Break code at its structure rather than wherever it runs out of room. */
  smartWrap?: boolean;
}

/**
 * Break after these so wrapped code splits somewhere readable.
 *
 * A lookup table rather than a `Set` of strings, because the obvious
 * `BREAK_AFTER.has(text[i])` builds a one-character string for every character
 * of every line it wraps. That allocation was 44% of the cost of a pinch on a
 * large document — more than the wrapping it was part of.
 */
const BREAK_AFTER = new Uint8Array(128);
for (const ch of ' \t,;)]}>-/|&.:') BREAK_AFTER[ch.charCodeAt(0)] = 1;

function canBreakAfter(text: string, index: number, cp: number, next: number): boolean {
  const code = text.charCodeAt(index);
  if (code < 128) {
    if (BREAK_AFTER[code]) return true;
  } else if (isWideCodePoint(cp)) {
    // Japanese and Chinese text has no spaces; breaking between glyphs is normal.
    return true;
  }
  const nextCp = text.codePointAt(next);
  return nextCp !== undefined && isWideCodePoint(nextCp);
}

/**
 * Maps between document positions and pixel coordinates.
 *
 * Everything here is arithmetic over a fixed character cell — no DOM
 * measurement, no `getBoundingClientRect` per keystroke. The renderer upholds
 * the cell invariant (see `renderer.ts`), which is what buys hit-testing that
 * stays instant while a finger is dragging the caret across a large file.
 */
export class Layout {
  private cache: (LineLayout | undefined)[] = [];
  /** Rows per document line; parallel to `cache`, filled as lines are laid out.
   *  `undefined` marks a line whose layout has not been computed yet. */
  private rows: (number | undefined)[] = [];
  /** Width of each line in columns. Depends on the text and the tab size, and
   *  on nothing about the font — which is what lets it outlive a resize. */
  private widths: (number | undefined)[] = [];
  /** Whether a line is free of anything that could form a grapheme cluster.
   *  Like `widths`, a fact about the text that a font change cannot alter. */
  private plain: (boolean | undefined)[] = [];
  private cumulative: Int32Array = new Int32Array(1);
  private cumulativeDirty = true;
  private wrapColumns = 80;
  private widestColumns = 0;
  /**
   * Bumped whenever cached line layouts are discarded. The renderer mixes this
   * into its per-line cache key: without it, a re-wrap triggered by a width or
   * font change would resize line boxes while leaving their painted rows stale.
   */
  private _generation = 0;

  private readonly buffer: TextBuffer;
  private readonly metrics: Metrics;
  options: LayoutOptions;

  constructor(buffer: TextBuffer, metrics: Metrics, options: LayoutOptions) {
    this.buffer = buffer;
    this.metrics = metrics;
    this.options = options;
  }

  /** Available content width in pixels; determines the wrap column. */
  setViewportWidth(px: number): boolean {
    const columns = Math.max(12, Math.floor(px / this.metrics.charWidth));
    if (columns === this.wrapColumns) return false;
    this.wrapColumns = columns;
    // Where the text breaks changes; how wide it is does not.
    if (this.options.wordWrap) this.invalidateWrap();
    return true;
  }

  get wrapCols(): number {
    return this.wrapColumns;
  }

  get generation(): number {
    return this._generation;
  }

  /** Throw away everything: the text or the tab size changed under us. */
  invalidateAll(): void {
    this.widths = [];
    this.plain = [];
    this.widestColumns = 0;
    this.invalidateWrap();
  }

  /**
   * Throw away where lines break, but not how wide they are.
   *
   * This is what a font size change needs, and the distinction is the
   * difference between a pinch that tracks the fingers and one that stalls: a
   * line's width in columns is a property of its text, so re-deriving it for
   * every line of a large document on every step of the gesture was work whose
   * answer could not have changed.
   */
  invalidateWrap(): void {
    this.cache = [];
    this.rows = [];
    this.cumulativeDirty = true;
    this._generation++;
  }

  /**
   * Tell the layout that `removed` lines starting at `start` became `added`
   * lines. Splicing rather than clearing keeps the layout of everything below
   * a small edit, which is most of the file.
   */
  linesChanged(start: number, removed: number, added: number): void {
    const blanks = new Array<LineLayout | undefined>(added).fill(undefined);
    this.cache.splice(start, removed, ...blanks);
    // Row counts for the new lines are unknown, not 1 — a placeholder here
    // would be taken at face value by `ensureCumulative` and misplace every
    // line below an edit that changed how many rows it wraps to.
    this.rows.splice(start, removed, ...new Array<number | undefined>(added).fill(undefined));
    this.widths.splice(start, removed, ...new Array<number | undefined>(added).fill(undefined));
    this.plain.splice(start, removed, ...new Array<boolean | undefined>(added).fill(undefined));
    this.cumulativeDirty = true;
  }

  lineLayout(line: number): LineLayout {
    const cached = this.cache[line];
    if (cached) return cached;

    const text = this.buffer.line(line);
    const computed = this.computeLine(text);
    this.cache[line] = computed;
    if (this.rows[line] !== computed.rowStarts.length) {
      this.rows[line] = computed.rowStarts.length;
      this.cumulativeDirty = true;
    }
    this.noteWidth(line, computed.width);
    return computed;
  }

  /**
   * Width of one line in columns, remembered across font changes.
   *
   * Also the fast answer to "does this line wrap at all", which for most lines
   * of most documents is no — and answering it from a number costs nothing
   * next to walking the text again.
   */
  private lineWidth(line: number): number {
    const known = this.widths[line];
    if (known !== undefined) return known;
    const width = lineColumns(this.buffer.line(line), this.options.tabSize);
    this.noteWidth(line, width);
    return width;
  }

  private noteWidth(line: number, width: number): void {
    this.widths[line] = width;
    // The widest line has to come from the whole document, not just the lines
    // that happen to be on screen — it is what sets the scrollable width when
    // wrapping is off, and a long line further down would otherwise be
    // unreachable.
    if (width > this.widestColumns) this.widestColumns = width;
  }

  private computeLine(text: string): LineLayout {
    const { tabSize, wordWrap } = this.options;
    const columns = columnMap(text, tabSize);
    const width = columns[text.length] ?? 0;

    if (!wordWrap || width <= this.wrapColumns) {
      return { rowStarts: [0], rowIndent: [0], columns, width };
    }

    const ends = clusterEnds(text);
    if (this.options.smartWrap) {
      const wrapped = smartWrap(text, columns, this.wrapColumns, tabSize, ends);
      return { ...wrapped, columns, width };
    }

    const rowStarts = [0];
    const rowIndent = [0];
    const indent = this.hangingIndent(text);
    this.wrapLine(text, indent, (start) => {
      rowStarts.push(start);
      rowIndent.push(indent);
    }, ends);
    return { rowStarts, rowIndent, columns, width };
  }

  /**
   * How far wrapped rows of this line are indented, in columns.
   *
   * Measured straight off the leading whitespace: it is spaces and tabs by
   * definition, so none of the cluster machinery `columnAt` would set up for
   * the whole line can change the answer.
   */
  private hangingIndent(text: string): number {
    const { tabSize } = this.options;
    const stop = firstNonWhitespace(text);
    let column = 0;
    for (let i = 0; i < stop; i++) {
      column += text.charCodeAt(i) === 9 ? tabSize - (column % tabSize) : 1;
    }
    return Math.min(column, Math.max(0, this.wrapColumns - 8));
  }

  /** Rows this line takes, without building anything that has to be kept. */
  private countRows(line: number): number {
    const text = this.buffer.line(line);
    // Asked for unconditionally, and before the wrap test can short-circuit
    // past it: with wrapping off this pass is the only thing that ever sees a
    // line the viewport has not reached, and the widest of them is what makes
    // the document scrollable sideways far enough to read it.
    const width = this.lineWidth(line);
    if (!this.options.wordWrap || width <= this.wrapColumns) return 1;
    // Smart wrap needs the column map to place its breaks, so counting it is
    // laying it out. Cheap enough: it only reaches here for lines that wrap.
    if (this.options.smartWrap) return this.computeLine(text).rowStarts.length;
    return this.wrapLine(text, this.hangingIndent(text), null, this.clusterEndsFor(line, text));
  }

  /**
   * Cluster boundaries for a line, skipping the scan for lines already known
   * to have none. Whether a line can form clusters is a property of its text,
   * so asking again on every re-wrap is a scan of the document for an answer
   * that was already written down.
   */
  private clusterEndsFor(line: number, text: string): Int32Array | null {
    if (this.plain[line]) return null;
    const ends = clusterEnds(text);
    this.plain[line] = ends === null;
    return ends;
  }

  /**
   * Walk one line's wrap points, reporting each row start, and return how many
   * rows it came to.
   *
   * Both callers share this. The layout wants where the rows begin; the pass
   * that rebuilds the row totals over the whole document wants only how many
   * there are, and used to get them by building — and immediately discarding —
   * a column map per line. On a large file during a pinch that was the whole
   * cost of the gesture, so the count now walks the text and allocates nothing.
   */
  private wrapLine(
    text: string,
    indent: number,
    onRow: ((start: number) => void) | null,
    ends: Int32Array | null,
  ): number {
    const { tabSize } = this.options;
    let rows = 1;
    let rowStart = 0;
    let rowStartColumn = 0;
    let column = 0;
    let currentIndent = 0;
    let lastOpportunity = -1;
    let lastOpportunityColumn = 0;
    let i = 0;

    while (i < text.length) {
      const code = text.charCodeAt(i);
      // Plain narrow characters are the overwhelming majority and need none of
      // the cluster machinery; skipping it here is worth the extra branch.
      const plain = ends === null && code !== 9 && code < 0x1100;
      const cp = plain ? code : (text.codePointAt(i) as number);
      // Whole glyphs, so a wrap can never land inside one.
      const next = plain ? i + 1 : endOfCluster(text, i, ends);
      const cells = plain ? 1 : clusterWidth(text, i, next, tabSize, column);
      const endColumn = column + cells - rowStartColumn + currentIndent;

      if (endColumn > this.wrapColumns && i > rowStart) {
        // Prefer the last break opportunity; fall back to a hard break for a
        // single token wider than the screen (a long URL, a base64 blob).
        const soft = lastOpportunity > rowStart;
        const breakAt = soft ? lastOpportunity : i;
        rows++;
        onRow?.(breakAt);
        rowStart = breakAt;
        rowStartColumn = soft ? lastOpportunityColumn : column;
        currentIndent = indent;
        lastOpportunity = -1;
        i = breakAt;
        column = rowStartColumn;
        continue;
      }

      // Inlined for the plain case: the general test costs a call and a
      // `codePointAt` per character, and neither can say anything new when the
      // character and the one after it are both narrow ASCII.
      let opportunity: boolean;
      if (plain) {
        opportunity = BREAK_AFTER[code] === 1;
        if (!opportunity && next < text.length && text.charCodeAt(next) >= 0x1100) {
          opportunity = isWideCodePoint(text.codePointAt(next) as number);
        }
      } else {
        opportunity = canBreakAfter(text, i, cp, next);
      }
      if (opportunity) {
        lastOpportunity = next;
        lastOpportunityColumn = column + cells;
      }
      column += cells;
      i = next;
    }

    return rows;
  }

  rowsInLine(line: number): number {
    return this.lineLayout(line).rowStarts.length;
  }

  /** Index of the first visual row of `line`, counting from the document top. */
  firstRowOfLine(line: number): number {
    this.ensureCumulative();
    const clamped = Math.max(0, Math.min(line, this.buffer.lineCount - 1));
    return this.cumulative[clamped];
  }

  get totalRows(): number {
    this.ensureCumulative();
    return this.cumulative[this.buffer.lineCount];
  }

  get widestLineColumns(): number {
    return this.widestColumns;
  }

  /** Which document line (and which of its rows) a global row index falls on. */
  lineAtRow(row: number): { line: number; rowInLine: number } {
    this.ensureCumulative();
    const total = this.cumulative[this.buffer.lineCount];
    if (row < 0) return { line: 0, rowInLine: 0 };
    if (row >= total) {
      const line = this.buffer.lineCount - 1;
      return { line, rowInLine: this.rowsInLine(line) - 1 };
    }

    let lo = 0;
    let hi = this.buffer.lineCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cumulative[mid] <= row) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, rowInLine: row - this.cumulative[lo] };
  }

  /**
   * Rebuild the row prefix sums.
   *
   * This counts the rows of every line whose count is not known, which is
   * O(document) — but only in cheap arithmetic with no allocation, and only
   * after a structural change. Per-line wrap results survive in `cache`, so a
   * keystroke re-wraps one line.
   */
  private ensureCumulative(): void {
    if (!this.cumulativeDirty) return;
    const count = this.buffer.lineCount;
    if (this.cumulative.length < count + 1) {
      this.cumulative = new Int32Array(Math.max(count + 1, this.cumulative.length * 2));
    }
    let total = 0;
    for (let i = 0; i < count; i++) {
      this.cumulative[i] = total;
      let rows = this.rows[i];
      if (rows === undefined) {
        // Counted, not laid out: this pass touches every line in the document,
        // and keeping a column map for each would cost tens of megabytes on a
        // large file to answer a question about row counts. Lines that are
        // actually drawn get their full layout from `lineLayout`.
        rows = this.cache[i]?.rowStarts.length ?? this.countRows(i);
        this.rows[i] = rows;
      }
      total += rows;
    }
    this.cumulative[count] = total;
    this.cumulativeDirty = false;
  }

  /** Which row of `line` contains string index `ch`. */
  rowOfIndex(line: number, ch: number): number {
    const { rowStarts } = this.lineLayout(line);
    let row = 0;
    // Rows per line are few; a scan beats a binary search and reads better.
    while (row + 1 < rowStarts.length && rowStarts[row + 1] <= ch) row++;
    return row;
  }

  /** Column of `ch` within its visual row, including the wrap indent. */
  columnInRow(line: number, ch: number): number {
    const layout = this.lineLayout(line);
    const row = this.rowOfIndex(line, ch);
    const start = layout.rowStarts[row];
    return layout.columns[Math.min(ch, layout.columns.length - 1)] - layout.columns[start] + layout.rowIndent[row];
  }

  /** Content-space pixel coordinates of a caret at `p`. */
  coordsAt(p: Position): { x: number; y: number; row: number } {
    const clamped = this.buffer.clamp(p);
    const row = this.firstRowOfLine(clamped.line) + this.rowOfIndex(clamped.line, clamped.ch);
    return {
      x: this.columnInRow(clamped.line, clamped.ch) * this.metrics.charWidth,
      y: row * this.metrics.lineHeight,
      row,
    };
  }

  /** The document position under a content-space pixel coordinate. */
  positionAt(x: number, y: number): Position {
    const row = Math.floor(y / this.metrics.lineHeight);
    const { line, rowInLine } = this.lineAtRow(row);
    return this.positionInRow(line, rowInLine, x);
  }

  /** The position at pixel `x` within a specific visual row. */
  positionInRow(line: number, rowInLine: number, x: number): Position {
    const layout = this.lineLayout(line);
    const text = this.buffer.line(line);
    const row = Math.max(0, Math.min(rowInLine, layout.rowStarts.length - 1));
    const start = layout.rowStarts[row];
    const end = row + 1 < layout.rowStarts.length ? layout.rowStarts[row + 1] : text.length;

    const target = x / this.metrics.charWidth - layout.rowIndent[row] + layout.columns[start];
    if (target <= layout.columns[start]) return pos(line, start);

    let i = start;
    while (i < end) {
      const cp = text.codePointAt(i) as number;
      const units = cp > 0xffff ? 2 : 1;
      const from = layout.columns[i];
      const to = layout.columns[i + units];
      if (target < to) {
        // Snap to whichever edge of the glyph is nearer.
        return pos(line, target - from >= (to - from) / 2 ? i + units : i);
      }
      i += units;
    }

    // Past the end of a wrapped row the caret belongs before the break, not
    // after it — otherwise it visually jumps to the start of the next row.
    const isLastRow = row === layout.rowStarts.length - 1;
    return pos(line, isLastRow ? end : Math.max(start, end - trailingBreakChars(text, start, end)));
  }
}

/** How many characters at the end of a wrapped row are the break itself. */
function trailingBreakChars(text: string, start: number, end: number): number {
  let n = 0;
  while (end - n > start && /[ \t]/.test(text[end - n - 1])) n++;
  return n;
}
