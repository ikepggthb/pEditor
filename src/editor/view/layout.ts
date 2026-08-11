import type { TextBuffer } from '../model/textBuffer.ts';
import { type Position, pos } from '../model/position.ts';
import { clusterEnds, columnMap, endOfCluster, isWideCodePoint } from './columns.ts';
import { firstNonWhitespace } from '../model/words.ts';
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
}

/** Break after these so wrapped code splits at somewhere readable. */
const BREAK_AFTER = new Set([' ', '\t', ',', ';', ')', ']', '}', '>', '-', '/', '|', '&', '.', ':']);

function canBreakAfter(text: string, index: number, cp: number, next: number): boolean {
  if (BREAK_AFTER.has(text[index])) return true;
  // Japanese and Chinese text has no spaces; breaking between glyphs is normal.
  if (isWideCodePoint(cp)) return true;
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
    if (this.options.wordWrap) this.invalidateAll();
    return true;
  }

  get wrapCols(): number {
    return this.wrapColumns;
  }

  get generation(): number {
    return this._generation;
  }

  invalidateAll(): void {
    this.cache = [];
    this.rows = [];
    this.cumulativeDirty = true;
    this.widestColumns = 0;
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
    if (computed.width > this.widestColumns) this.widestColumns = computed.width;
    return computed;
  }

  private computeLine(text: string): LineLayout {
    const { tabSize, wordWrap } = this.options;
    const columns = columnMap(text, tabSize);
    const width = columns[text.length] ?? 0;

    if (!wordWrap || width <= this.wrapColumns) {
      return { rowStarts: [0], rowIndent: [0], columns, width };
    }

    const indentCap = Math.max(0, this.wrapColumns - 8);
    const indent = Math.min(columns[firstNonWhitespace(text)] ?? 0, indentCap);

    const rowStarts = [0];
    const rowIndent = [0];
    const ends = clusterEnds(text);
    let rowStart = 0;
    let currentIndent = 0;
    let lastOpportunity = -1;
    let i = 0;

    while (i < text.length) {
      const cp = text.codePointAt(i) as number;
      // Whole glyphs, so a wrap can never land inside one.
      const next = endOfCluster(text, i, ends);
      const units = next - i;
      const endColumn = columns[i + units] - columns[rowStart] + currentIndent;

      if (endColumn > this.wrapColumns && i > rowStart) {
        // Prefer the last break opportunity; fall back to a hard break for a
        // single token wider than the screen (a long URL, a base64 blob).
        const breakAt = lastOpportunity > rowStart ? lastOpportunity : i;
        rowStarts.push(breakAt);
        rowIndent.push(indent);
        rowStart = breakAt;
        currentIndent = indent;
        lastOpportunity = -1;
        i = breakAt;
        continue;
      }

      if (canBreakAfter(text, i, cp, next)) lastOpportunity = next;
      i = next;
    }

    return { rowStarts, rowIndent, columns, width };
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
   * This lays out every line that has not been laid out yet, which is O(document)
   * — but only in cheap arithmetic, and only after a structural change. Per-line
   * wrap results survive in `cache`, so a keystroke re-wraps one line.
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
        // Compute the wrap but don't cache it: this pass touches every line in
        // the document, and retaining a column map for each would cost tens of
        // megabytes on a large file to answer a question about row counts.
        // Lines that are actually drawn get cached by `lineLayout`.
        const info = this.cache[i] ?? this.computeLine(this.buffer.line(i));
        rows = info.rowStarts.length;
        this.rows[i] = rows;
        // The widest line has to come from the whole document, not just the
        // lines that happen to be on screen — it is what sets the scrollable
        // width when wrapping is off, and a long line further down would
        // otherwise be unreachable.
        if (info.width > this.widestColumns) this.widestColumns = info.width;
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
