import type { Editor } from './editor.ts';
import { pos, type Position, type TextRange } from '../model/position.ts';
import {
  type Selection,
  selectionEnd,
  selectionIsEmpty,
  selectionRange,
  selectionStart,
} from '../model/selection.ts';
import { firstNonWhitespace, nextWordBoundary, wordBoundsAt } from '../model/words.ts';
import { columnAt } from '../view/columns.ts';

const CLOSERS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
  '`': '`',
};

const OPENERS = new Set(Object.keys(CLOSERS));
const CLOSING = new Set(Object.values(CLOSERS));

export function indentUnit(editor: Editor): string {
  return editor.config.insertSpaces ? ' '.repeat(editor.config.tabSize) : '\t';
}

function leadingWhitespace(text: string): string {
  return /^[ \t]*/.exec(text)?.[0] ?? '';
}

/** The lines a selection touches, as a whole-line range. */
function selectedLineRange(editor: Editor): { firstLine: number; lastLine: number; range: TextRange } {
  const from = selectionStart(editor.selection);
  const to = selectionEnd(editor.selection);
  // A selection ending exactly at column 0 hasn't really reached that line.
  const lastLine = to.line > from.line && to.ch === 0 ? to.line - 1 : to.line;
  return {
    firstLine: from.line,
    lastLine,
    range: { from: pos(from.line, 0), to: pos(lastLine, editor.buffer.lineLength(lastLine)) },
  };
}

/**
 * Insert text at the caret, auto-closing brackets and quotes.
 *
 * Auto-close earns its place on a phone specifically: `)` and `}` are two taps
 * away on most soft keyboards, so not having to type them is a real saving.
 */
export function insertText(editor: Editor, text: string): void {
  const selection = editor.selection;

  if (editor.config.autoCloseBrackets && text.length === 1) {
    const closer = CLOSERS[text];

    // Wrap a selection in the pair rather than replacing it.
    if (closer && !selectionIsEmpty(selection)) {
      const range = selectionRange(selection);
      const inner = editor.buffer.getText(range);
      const result = editor.edit(range, text + inner + closer, 'input');
      const start = editor.buffer.stepPosition(result.insertedRange.from, 1);
      const end = editor.buffer.stepPosition(result.insertedRange.to, -1);
      editor.setSelection({ anchor: start, head: end });
      return;
    }

    const line = editor.buffer.line(selection.head.line);
    const after = line.slice(selection.head.ch, selection.head.ch + 1);

    // Typing the closer that is already there just steps over it.
    if (CLOSING.has(text) && after === text) {
      editor.setCaret(editor.buffer.stepPosition(selection.head, 1));
      return;
    }

    if (closer && shouldAutoClose(text, line, selection.head.ch)) {
      const result = editor.edit(selectionRange(selection), text + closer, 'input');
      editor.setCaret(editor.buffer.stepPosition(result.insertedRange.to, -1));
      return;
    }
  }

  editor.insert(text, 'input');
}

function shouldAutoClose(open: string, line: string, ch: number): boolean {
  const after = line.slice(ch, ch + 1);
  // Don't auto-close when it would run into a word — `(` before `foo`.
  if (after && !/[\s)\]}>,;.]/.test(after)) return false;
  if (open === '"' || open === "'" || open === '`') {
    const before = line.slice(Math.max(0, ch - 1), ch);
    // Apostrophes in prose (and identifiers) shouldn't open a string.
    if (before && /[\w$]/.test(before)) return false;
  }
  return true;
}

/** Enter, with indentation carried over and brackets opened onto their own line. */
export function insertNewline(editor: Editor): void {
  if (!editor.config.autoIndent) {
    editor.insert('\n', 'input');
    return;
  }

  const head = selectionStart(editor.selection);
  const line = editor.buffer.line(head.line);
  const indent = leadingWhitespace(line.slice(0, head.ch));
  const before = line.slice(Math.max(0, head.ch - 1), head.ch);
  const after = line.slice(selectionEnd(editor.selection).ch);
  const unit = indentUnit(editor);

  if (OPENERS.has(before) && CLOSERS[before] === after.slice(0, 1)) {
    // Caret sits between a pair: open a body and leave the closer below.
    const result = editor.edit(selectionRange(editor.selection), `\n${indent}${unit}\n${indent}`, 'input');
    editor.setCaret(pos(result.insertedRange.from.line + 1, indent.length + unit.length));
    return;
  }

  const extra = OPENERS.has(before) && before !== '"' && before !== "'" && before !== '`' ? unit : '';
  editor.insert(`\n${indent}${extra}`, 'input');
}

/** Tab: indent the selected lines, or move to the next tab stop. */
export function insertTab(editor: Editor): void {
  const selection = editor.selection;
  const from = selectionStart(selection);
  const to = selectionEnd(selection);

  if (from.line !== to.line) {
    indentLines(editor, 1);
    return;
  }

  if (editor.config.insertSpaces) {
    const column = columnAt(editor.buffer.line(from.line), from.ch, editor.config.tabSize);
    const width = editor.config.tabSize - (column % editor.config.tabSize);
    editor.insert(' '.repeat(width), 'input');
  } else {
    editor.insert('\t', 'input');
  }
}

/** Add or remove one indent level across the selected lines, as one undo step. */
export function indentLines(editor: Editor, direction: 1 | -1): void {
  const { firstLine, lastLine, range } = selectedLineRange(editor);
  const unit = indentUnit(editor);
  const before = editor.selection;

  const lines: string[] = [];
  let firstDelta = 0;
  let lastDelta = 0;

  for (let line = firstLine; line <= lastLine; line++) {
    const text = editor.buffer.line(line);
    let next: string;
    if (direction === 1) {
      next = text.length === 0 ? text : unit + text;
    } else {
      next = removeOneIndent(text, editor.config.tabSize);
    }
    const delta = next.length - text.length;
    if (line === firstLine) firstDelta = delta;
    if (line === lastLine) lastDelta = delta;
    lines.push(next);
  }

  editor.edit(range, lines.join('\n'), 'command');
  editor.setSelection(shiftSelection(editor, before, firstLine, lastLine, firstDelta, lastDelta));
}

function removeOneIndent(text: string, tabSize: number): string {
  if (text.startsWith('\t')) return text.slice(1);
  let removed = 0;
  while (removed < tabSize && text[removed] === ' ') removed++;
  return text.slice(removed);
}

/** Keep the selection over the same text after every line shifted by an indent. */
function shiftSelection(
  editor: Editor,
  before: Selection,
  firstLine: number,
  lastLine: number,
  firstDelta: number,
  lastDelta: number,
): Selection {
  const adjust = (p: Position): Position => {
    if (p.line < firstLine || p.line > lastLine) return p;
    const delta = p.line === firstLine ? firstDelta : p.line === lastLine ? lastDelta : 0;
    return pos(p.line, Math.max(0, Math.min(p.ch + delta, editor.buffer.lineLength(p.line))));
  };
  return { anchor: adjust(before.anchor), head: adjust(before.head) };
}

export function deleteBackward(editor: Editor): void {
  const selection = editor.selection;
  if (!selectionIsEmpty(selection)) {
    editor.edit(selectionRange(selection), '', 'delete');
    return;
  }

  const head = selection.head;
  if (head.ch === 0) {
    if (head.line === 0) return;
    const previousEnd = pos(head.line - 1, editor.buffer.lineLength(head.line - 1));
    editor.edit({ from: previousEnd, to: head }, '', 'delete');
    return;
  }

  const line = editor.buffer.line(head.line);
  const before = line.slice(0, head.ch);

  // Inside leading indentation, backspace removes a whole level.
  if (/^[ ]+$/.test(before) && editor.config.insertSpaces) {
    const width = ((before.length - 1) % editor.config.tabSize) + 1;
    editor.edit({ from: pos(head.line, head.ch - width), to: head }, '', 'delete');
    return;
  }

  // Delete both halves of an auto-closed pair.
  const previousChar = line[head.ch - 1];
  if (editor.config.autoCloseBrackets && OPENERS.has(previousChar) && line[head.ch] === CLOSERS[previousChar]) {
    editor.edit({ from: pos(head.line, head.ch - 1), to: pos(head.line, head.ch + 1) }, '', 'delete');
    return;
  }

  const from = editor.buffer.stepPosition(head, -1);
  editor.edit({ from, to: head }, '', 'delete');
}

export function deleteForward(editor: Editor): void {
  const selection = editor.selection;
  if (!selectionIsEmpty(selection)) {
    editor.edit(selectionRange(selection), '', 'delete');
    return;
  }
  const head = selection.head;
  const to = editor.buffer.stepPosition(head, 1);
  editor.edit({ from: head, to }, '', 'delete');
}

export function deleteWordBackward(editor: Editor): void {
  const selection = editor.selection;
  if (!selectionIsEmpty(selection)) {
    editor.edit(selectionRange(selection), '', 'delete');
    return;
  }
  const head = selection.head;
  if (head.ch === 0) {
    deleteBackward(editor);
    return;
  }
  const target = nextWordBoundary(editor.buffer.line(head.line), head.ch, -1);
  editor.edit({ from: pos(head.line, target), to: head }, '', 'delete');
}

export function deleteToLineEnd(editor: Editor): void {
  const head = editor.selection.head;
  const length = editor.buffer.lineLength(head.line);
  if (head.ch >= length) {
    deleteForward(editor);
    return;
  }
  editor.edit({ from: head, to: pos(head.line, length) }, '', 'delete');
}

export function moveWord(editor: Editor, dir: 1 | -1, extend: boolean): void {
  const head = editor.selection.head;
  const text = editor.buffer.line(head.line);
  let target: Position;

  if (dir === -1 && head.ch === 0) {
    target = head.line === 0 ? head : pos(head.line - 1, editor.buffer.lineLength(head.line - 1));
  } else if (dir === 1 && head.ch >= text.length) {
    target = head.line >= editor.buffer.lineCount - 1 ? head : pos(head.line + 1, 0);
  } else {
    target = pos(head.line, nextWordBoundary(text, head.ch, dir));
  }
  editor.setSelection({ anchor: extend ? editor.selection.anchor : target, head: target });
}

export function selectWordAt(editor: Editor, p: Position): void {
  const text = editor.buffer.line(p.line);
  const { start, end } = wordBoundsAt(text, p.ch);
  editor.setSelection({ anchor: pos(p.line, start), head: pos(p.line, end) });
}

export function selectLineAt(editor: Editor, line: number): void {
  const last = editor.buffer.lineCount - 1;
  const head = line < last ? pos(line + 1, 0) : pos(line, editor.buffer.lineLength(line));
  editor.setSelection({ anchor: pos(line, 0), head });
}

export function duplicateSelection(editor: Editor): void {
  const selection = editor.selection;
  if (selectionIsEmpty(selection)) {
    const line = selection.head.line;
    const text = editor.buffer.line(line);
    const end = pos(line, text.length);
    editor.edit({ from: end, to: end }, `\n${text}`, 'command');
    editor.setCaret(pos(line + 1, selection.head.ch));
    return;
  }
  const range = selectionRange(selection);
  const text = editor.buffer.getText(range);
  const result = editor.edit({ from: range.to, to: range.to }, text, 'command');
  editor.setSelection({ anchor: range.to, head: result.insertedRange.to });
}

export function moveLines(editor: Editor, direction: 1 | -1): void {
  const { firstLine, lastLine } = selectedLineRange(editor);
  const target = direction === -1 ? firstLine - 1 : lastLine + 1;
  if (target < 0 || target >= editor.buffer.lineCount) return;

  const before = editor.selection;
  const block: string[] = [];
  for (let line = firstLine; line <= lastLine; line++) block.push(editor.buffer.line(line));
  const neighbour = editor.buffer.line(target);

  const from = pos(Math.min(firstLine, target), 0);
  const toLine = Math.max(lastLine, target);
  const to = pos(toLine, editor.buffer.lineLength(toLine));
  const lines = direction === -1 ? [...block, neighbour] : [neighbour, ...block];

  editor.edit({ from, to }, lines.join('\n'), 'command');
  editor.setSelection({
    anchor: pos(before.anchor.line + direction, before.anchor.ch),
    head: pos(before.head.line + direction, before.head.ch),
  });
}

/** Toggle line comments across the selection, using the language's syntax. */
export function toggleComment(editor: Editor): void {
  const token = editor.language.lineComment;
  if (!token) return;

  const { firstLine, lastLine, range } = selectedLineRange(editor);
  const before = editor.selection;

  let allCommented = true;
  let minIndent = Infinity;
  for (let line = firstLine; line <= lastLine; line++) {
    const text = editor.buffer.line(line);
    if (text.trim().length === 0) continue;
    const indent = firstNonWhitespace(text);
    minIndent = Math.min(minIndent, indent);
    if (!text.slice(indent).startsWith(token)) allCommented = false;
  }
  if (!Number.isFinite(minIndent)) minIndent = 0;

  const lines: string[] = [];
  let firstDelta = 0;
  let lastDelta = 0;

  for (let line = firstLine; line <= lastLine; line++) {
    const text = editor.buffer.line(line);
    let next = text;
    if (text.trim().length === 0) {
      lines.push(text);
      continue;
    }
    if (allCommented) {
      const indent = firstNonWhitespace(text);
      const rest = text.slice(indent + token.length);
      next = text.slice(0, indent) + (rest.startsWith(' ') ? rest.slice(1) : rest);
    } else {
      next = text.slice(0, minIndent) + token + ' ' + text.slice(minIndent);
    }
    const delta = next.length - text.length;
    if (line === firstLine) firstDelta = delta;
    if (line === lastLine) lastDelta = delta;
    lines.push(next);
  }

  editor.edit(range, lines.join('\n'), 'command');
  editor.setSelection(shiftSelection(editor, before, firstLine, lastLine, firstDelta, lastDelta));
}
