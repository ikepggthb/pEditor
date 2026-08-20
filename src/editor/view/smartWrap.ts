import { clusterWidth, endOfCluster } from './columns.ts';

/**
 * Where a long line of code should break to be read on a phone.
 *
 * Ordinary soft wrap breaks wherever the text runs out of room, which for prose
 * is right and for code is close to useless: an argument list snapped in the
 * middle of an identifier tells you nothing about the structure you were
 * following. This breaks where a person would.
 *
 *     const result = compute(alpha, beta, gamma) + fallback(delta);
 *
 *     const result = compute(
 *         alpha,
 *         beta,
 *         gamma,
 *       )
 *       + fallback(delta);
 *
 * The rule that does most of the work is the one every code formatter uses: a
 * bracketed group either fits on one row or comes apart completely. Half-filled
 * rows — two arguments here, one there, wherever the edge happened to fall —
 * are what makes wrapped code unreadable, because the layout then says nothing
 * about the structure. All or nothing says everything.
 *
 * It is a *view*, not a formatter. The file is not touched: this is somebody
 * else's repository, and a reader that rewrote what it showed would make every
 * file it opened look modified. Switching it off restores the plain wrap.
 */

/** Break rather than overflow, even with nowhere good to break. */
const MIN_ROOM = 8;
/** Beyond this, finding the bracket pairs is not worth the scan. */
const MAX_SCAN = 4000;

export interface SmartWrapResult {
  /** String index where each visual row begins; always starts with 0. */
  rowStarts: number[];
  /** Column each row is indented by. Row 0 is never indented. */
  rowIndent: number[];
}

/** How strongly a position wants to be a break. Higher wins. */
const RANK_NONE = 0;
/** Anywhere at all — inside a long word, as a last resort. */
const RANK_HARD = 1;
/** After a space. */
const RANK_SPACE = 2;
/** Before a binary operator, so the operator starts the row. */
const RANK_OPERATOR = 3;
/** After a comma. */
const RANK_COMMA = 4;

const OPENERS = '([{';
const CLOSERS = ')]}';

/**
 * Operators worth starting a row with. Leading rather than trailing, because a
 * row that starts with `&&` announces what it is before you read it, and a row
 * that ends with one makes you remember.
 */
const OPERATOR_STARTS = [
  '&&', '||', '??', '==', '!=', '<=', '>=', '=>', '->', '::', '|>',
  '+', '-', '*', '/', '%', '<', '>', '&', '|', '?', ':', '.',
];
/** Every character an operator can be made of, for finding where one starts. */
const OPERATOR_CHARS = new Set('&|=!<>+-*/%?:.~^');

function operatorAt(text: string, i: number): boolean {
  // Only ever at the start of a run, so `&&` is one break point and not two —
  // the second `&` would otherwise win as the later candidate of equal rank,
  // and the row would begin with a lone ampersand.
  if (OPERATOR_CHARS.has(text[i - 1] ?? '')) return false;
  for (const op of OPERATOR_STARTS) {
    if (!text.startsWith(op, i)) continue;
    // `.` is a break point for a method chain and not for `a.b` inside a word.
    if (op === '.' && !/[)\]\w]/.test(text[i - 1] ?? '')) return false;
    return true;
  }
  return false;
}

interface Group {
  /** Index of the closing bracket. */
  close: number;
  /** Indices of the commas directly inside this group. */
  commas: number[];
}

/**
 * Find each bracket pair and the commas directly inside it.
 *
 * Everything inside a string is skipped: a comma in a message is punctuation,
 * and a bracket in one is a character. Comments are left alone too — there is
 * no structure in them worth respecting, only spaces.
 */
function scan(text: string): Map<number, Group> {
  const groups = new Map<number, Group>();
  const stack: number[] = [];
  let quote = '';

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (OPENERS.includes(ch)) {
      stack.push(i);
      groups.set(i, { close: text.length, commas: [] });
    } else if (CLOSERS.includes(ch)) {
      const open = stack.pop();
      if (open !== undefined) (groups.get(open) as Group).close = i;
    } else if (ch === ',' && stack.length) {
      (groups.get(stack[stack.length - 1]) as Group).commas.push(i);
    }
  }
  return groups;
}

/**
 * Break one line into rows no wider than `width` columns.
 *
 * `columns[i]` is the column of index `i`, as `columnMap` produces it, so this
 * agrees with the rest of the layout about how wide a tab or a CJK glyph is.
 */
export function smartWrap(
  text: string,
  columns: Int32Array,
  width: number,
  tabSize: number,
  ends: Int32Array | null,
): SmartWrapResult {
  const rowStarts = [0];
  const rowIndent = [0];

  const baseIndent = leadingColumns(text, tabSize);
  const step = Math.max(2, Math.min(tabSize, 4));
  const groups = text.length <= MAX_SCAN ? scan(text) : new Map<number, Group>();

  /** Bracket groups currently open, and whether each one is coming apart. */
  const stack: {
    close: number;
    open: boolean;
    /** Indent for the group's contents. */
    indent: number;
    /** Indent to return to for the closing bracket. */
    outer: number;
    commas: Set<number>;
  }[] = [];
  let indent = 0;
  let rowStart = 0;
  let rowStartColumn = 0;

  let best = -1;
  let bestRank = RANK_NONE;
  let bestIndent = 0;

  let i = 0;
  let column = 0;
  let quote = '';

  const remember = (at: number, rank: number, nextIndent: number) => {
    if (at <= rowStart || at >= text.length || rank < bestRank) return;
    best = at;
    bestRank = rank;
    bestIndent = nextIndent;
  };

  const breakAt = (at: number, nextIndent: number) => {
    rowStarts.push(at);
    rowIndent.push(nextIndent);
    rowStart = at;
    rowStartColumn = columns[at];
    indent = nextIndent;
    best = -1;
    bestRank = RANK_NONE;
  };

  /** Columns this row has used, if the glyph at `i` were added to it. */
  const usedThrough = (end: number) => columns[end] - rowStartColumn + indent;

  while (i < text.length) {
    const ch = text[i];
    const next = endOfCluster(text, i, ends);

    if (quote) {
      if (ch === '\\') {
        i = Math.min(i + 2, text.length);
        column = columns[i];
        continue;
      }
      if (ch === quote) quote = '';
    }

    const open = stack.length ? stack[stack.length - 1] : null;

    // A group that has been opened out puts each of its items on its own row.
    if (open?.open && (open.close === i || open.commas.has(i))) {
      if (open.close === i) {
        // The closing bracket starts a row of its own, back at the outer level.
        if (i > rowStart) breakAt(i, open.outer);
      } else {
        const after = skipSpace(text, i + 1);
        if (after < text.length && after > rowStart) breakAt(after, open.indent);
        i = after;
        column = columns[i];
        continue;
      }
    }

    if (CLOSERS.includes(ch) && !quote && open && open.close === i) stack.pop();

    const cells = clusterWidth(text, i, next, tabSize, column);
    if (usedThrough(next) > width && i > rowStart) {
      // Nothing structural claimed this point, so fall back to the best
      // candidate seen — a comma, an operator, a space, or failing all of
      // those, right here.
      const at = best > rowStart ? best : i;
      breakAt(at, best > rowStart ? bestIndent : indent || baseIndent + step);
      // Everything between the break and here belongs to the new row.
      i = at;
      column = columns[at];
      continue;
    }

    if (!quote) {
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
      } else if (OPENERS.includes(ch)) {
        const group = groups.get(i);
        const close = group ? group.close : text.length;
        // Row 0 has no hanging indent — its indentation is the line's own
        // leading whitespace, which is text. Continuations have to start from
        // that, or a closing bracket lands left of the line it belongs to.
        const outer = indent || baseIndent;
        const inner = outer + step;
        // Does the whole group still fit on this row? If not it comes apart,
        // and every item inside it gets a row.
        const fits = columns[Math.min(close + 1, text.length)] - rowStartColumn + indent <= width;
        stack.push({
          close,
          open: !fits && Boolean(group),
          indent: inner,
          outer,
          commas: new Set(group ? group.commas : []),
        });
        if (!fits && group) {
          const after = skipSpace(text, i + 1);
          if (after < text.length && after > rowStart) {
            breakAt(after, inner);
            i = after;
            column = columns[i];
            continue;
          }
        }
        // No candidate is left behind for a group that fits: breaking just
        // inside a bracket that was going to fit anyway strands the bracket on
        // a row of its own, which is worse than breaking at a space.
      } else if (ch === ',') {
        // Only a comma that belongs to a group coming apart — or one at the top
        // level of the line — is worth a row of its own. A comma inside a call
        // that fits is not a break point at all: breaking there is precisely the
        // half-open shape this is meant to avoid, and `f(a,` followed by `b)` on
        // the next row says less than `f(a, b)` on either.
        if (!open || open.open) {
          remember(skipSpace(text, i + 1), RANK_COMMA, currentIndent(stack, baseIndent, step));
        }
      } else if (operatorAt(text, i)) {
        remember(i, RANK_OPERATOR, currentIndent(stack, baseIndent, step));
      }
    }

    if (ch === ' ' || ch === '\t') {
      remember(skipSpace(text, next), RANK_SPACE, currentIndent(stack, baseIndent, step));
    } else if (bestRank === RANK_NONE && width - usedThrough(next) < MIN_ROOM) {
      remember(next, RANK_HARD, currentIndent(stack, baseIndent, step));
    }

    column += cells;
    i = next;
  }

  return { rowStarts, rowIndent };
}

function currentIndent(stack: { indent: number }[], baseIndent: number, step: number): number {
  return stack.length ? stack[stack.length - 1].indent : baseIndent + step;
}

function skipSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return i;
}

/** Width of the line's own leading whitespace, in columns. */
function leadingColumns(text: string, tabSize: number): number {
  let column = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 9) column += tabSize - (column % tabSize);
    else if (code === 32) column += 1;
    else break;
  }
  return column;
}
