import {
  type Position,
  type TextRange,
  comparePositions,
  pos,
  positionsEqual,
} from './position.ts';
import { stepIndex } from '../view/columns.ts';

/** The result of applying an edit — everything undo needs to reverse it. */
export interface EditResult {
  /** The range the edit replaced, as it was before the edit. */
  readonly replaced: TextRange;
  /** The text that used to be there. */
  readonly removed: string;
  /** The text now there. */
  readonly inserted: string;
  /** The range the inserted text occupies now. Starts at `replaced.from`. */
  readonly insertedRange: TextRange;
}

const LINE_SPLIT = /\r\n|\r|\n/;

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00) {
      // Surrogate pair: four bytes for the pair, and skip its low half.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * The document, stored as an array of lines.
 *
 * An array of lines is the wrong data structure for a 200MB log file and the
 * right one for everything you would plausibly edit on a phone: edits are a
 * single `splice`, and line-indexed rendering (which is what the view wants)
 * needs no extra index at all.
 */
export class TextBuffer {
  private lines: string[];
  private lineEnding: '\n' | '\r\n';
  /** Bumped on every mutation so caches can tell whether they are stale. */
  private _version = 0;

  constructor(text = '') {
    this.lineEnding = /\r\n/.test(text) ? '\r\n' : '\n';
    this.lines = text.split(LINE_SPLIT);
  }

  get version(): number {
    return this._version;
  }

  get lineCount(): number {
    return this.lines.length;
  }

  /** The line ending this document was loaded with; used when serialising. */
  get eol(): '\n' | '\r\n' {
    return this.lineEnding;
  }

  line(index: number): string {
    return this.lines[index] ?? '';
  }

  lineLength(index: number): number {
    return this.lines[index]?.length ?? 0;
  }

  /** The last valid position in the document. */
  end(): Position {
    const last = this.lines.length - 1;
    return pos(last, this.lines[last].length);
  }

  /** Snap an arbitrary position onto a real location in this document. */
  clamp(p: Position): Position {
    if (p.line < 0) return pos(0, 0);
    if (p.line >= this.lines.length) return this.end();
    const len = this.lines[p.line].length;
    if (p.ch < 0) return pos(p.line, 0);
    if (p.ch > len) return pos(p.line, len);
    return p;
  }

  clampRange(r: TextRange): TextRange {
    const from = this.clamp(r.from);
    const to = this.clamp(r.to);
    return comparePositions(from, to) <= 0 ? { from, to } : { from: to, to: from };
  }

  getText(r?: TextRange): string {
    if (!r) return this.lines.join(this.lineEnding);
    const { from, to } = this.clampRange(r);
    if (from.line === to.line) return this.lines[from.line].slice(from.ch, to.ch);

    const parts: string[] = [this.lines[from.line].slice(from.ch)];
    for (let i = from.line + 1; i < to.line; i++) parts.push(this.lines[i]);
    parts.push(this.lines[to.line].slice(0, to.ch));
    return parts.join('\n');
  }

  /**
   * Replace `r` with `text`. This is the only mutation in the buffer —
   * insertion is a replace of an empty range, deletion is a replace with ''.
   */
  replace(r: TextRange, text: string): EditResult {
    const replaced = this.clampRange(r);
    const removed = this.getText(replaced);

    if (removed === text) {
      // A genuine no-op. Don't bump the version; the view has nothing to redraw.
      return { replaced, removed, inserted: text, insertedRange: replaced };
    }

    const { from, to } = replaced;
    const prefix = this.lines[from.line].slice(0, from.ch);
    const suffix = this.lines[to.line].slice(to.ch);
    const insertedLines = text.split(LINE_SPLIT);

    let endPos: Position;
    if (insertedLines.length === 1) {
      this.lines.splice(from.line, to.line - from.line + 1, prefix + insertedLines[0] + suffix);
      endPos = pos(from.line, prefix.length + insertedLines[0].length);
    } else {
      const last = insertedLines.length - 1;
      const replacement = insertedLines.slice();
      replacement[0] = prefix + replacement[0];
      replacement[last] = replacement[last] + suffix;
      this.lines.splice(from.line, to.line - from.line + 1, ...replacement);
      endPos = pos(from.line + last, insertedLines[last].length);
    }

    this._version++;
    return {
      replaced,
      removed,
      inserted: text,
      insertedRange: { from, to: endPos },
    };
  }

  /**
   * UTF-8 size of the document, computed without materialising it.
   *
   * The obvious `new Blob([getText()]).size` copies the entire document to
   * measure it, which is fine once and ruinous if the status bar asks per
   * keystroke.
   */
  byteLength(): number {
    let bytes = 0;
    for (const line of this.lines) bytes += utf8Length(line);
    return bytes + (this.lines.length - 1) * this.lineEnding.length;
  }

  /** Replace the whole document, e.g. when opening a different file. */
  setText(text: string): void {
    this.lineEnding = /\r\n/.test(text) ? '\r\n' : '\n';
    this.lines = text.split(LINE_SPLIT);
    this._version++;
  }

  /**
   * Step one glyph left/right from `p`, crossing line boundaries.
   *
   * A glyph, not a code point: `👨‍👩‍👧` is eight code points and one thing on
   * screen, and a caret that stops between them would let the next keystroke
   * cut it into a crowd. This is also what backspace deletes by.
   */
  stepPosition(p: Position, dir: 1 | -1): Position {
    const c = this.clamp(p);
    if (dir === -1) {
      if (c.ch === 0) {
        if (c.line === 0) return c;
        return pos(c.line - 1, this.lineLength(c.line - 1));
      }
      return pos(c.line, stepIndex(this.line(c.line), c.ch, -1));
    }

    const text = this.line(c.line);
    if (c.ch >= text.length) {
      if (c.line >= this.lines.length - 1) return c;
      return pos(c.line + 1, 0);
    }
    return pos(c.line, stepIndex(text, c.ch, 1));
  }

  /** True when `a` and `b` denote the same spot. Convenience re-export. */
  static samePosition(a: Position, b: Position): boolean {
    return positionsEqual(a, b);
  }
}
