import {
  type Position,
  type TextRange,
  comparePositions,
  positionsEqual,
  range,
} from './position.ts';

/**
 * The selection, as an anchor (the end that stays put) and a head (the end that
 * moves). Keeping them separate — rather than storing a sorted range — is what
 * makes shift-arrow and drag-to-extend behave: the range can flip direction
 * without the caret jumping to the other side.
 */
export interface Selection {
  readonly anchor: Position;
  readonly head: Position;
}

export function selectionAt(p: Position): Selection {
  return { anchor: p, head: p };
}

export function selectionRange(sel: Selection): TextRange {
  return range(sel.anchor, sel.head);
}

export function selectionIsEmpty(sel: Selection): boolean {
  return positionsEqual(sel.anchor, sel.head);
}

/** The visually-first end, wherever the head happens to be. */
export function selectionStart(sel: Selection): Position {
  return comparePositions(sel.anchor, sel.head) <= 0 ? sel.anchor : sel.head;
}

export function selectionEnd(sel: Selection): Position {
  return comparePositions(sel.anchor, sel.head) <= 0 ? sel.head : sel.anchor;
}

export function selectionsEqual(a: Selection, b: Selection): boolean {
  return positionsEqual(a.anchor, b.anchor) && positionsEqual(a.head, b.head);
}
