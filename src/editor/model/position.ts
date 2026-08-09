/**
 * A caret location inside the document.
 *
 * `ch` is an index into the line's JavaScript string (UTF-16 code units), not a
 * visual column. Everything that needs a visual column goes through
 * `view/columns.ts`; keeping the model in code units means edits never have to
 * think about fonts or tab stops.
 */
export interface Position {
  readonly line: number;
  readonly ch: number;
}

/** A contiguous span of the document. `from` is always <= `to`. */
export interface TextRange {
  readonly from: Position;
  readonly to: Position;
}

export function pos(line: number, ch: number): Position {
  return { line, ch };
}

export function range(from: Position, to: Position): TextRange {
  return comparePositions(from, to) <= 0 ? { from, to } : { from: to, to: from };
}

/** An empty range at `p` — what an insertion point looks like. */
export function emptyRange(p: Position): TextRange {
  return { from: p, to: p };
}

export function comparePositions(a: Position, b: Position): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.ch - b.ch;
}

export function positionsEqual(a: Position, b: Position): boolean {
  return a.line === b.line && a.ch === b.ch;
}

export function rangeIsEmpty(r: TextRange): boolean {
  return positionsEqual(r.from, r.to);
}

export function minPosition(a: Position, b: Position): Position {
  return comparePositions(a, b) <= 0 ? a : b;
}

export function maxPosition(a: Position, b: Position): Position {
  return comparePositions(a, b) >= 0 ? a : b;
}
