import type { EditResult } from '../model/textBuffer.ts';
import type { Selection } from '../model/selection.ts';
import type { Position, TextRange } from '../model/position.ts';

/** Where an edit came from. Undo uses this to decide what to merge. */
export type EditOrigin = 'input' | 'delete' | 'paste' | 'command' | 'history';

/** One reversible edit: enough to replay it forwards or backwards. */
interface Change {
  from: Position;
  /** Where the inserted text ends, i.e. the range to remove when undoing. */
  insertedTo: Position;
  /** Where the removed text ended, i.e. the range to remove when redoing. */
  removedTo: Position;
  inserted: string;
  removed: string;
}

interface Entry {
  changes: Change[];
  selBefore: Selection;
  selAfter: Selection;
  origin: EditOrigin;
  time: number;
}

/** How long a typing run can pause before it becomes a separate undo step. */
const COALESCE_MS = 600;
const MAX_DEPTH = 500;

function changeOf(result: EditResult): Change {
  return {
    from: result.replaced.from,
    insertedTo: result.insertedRange.to,
    removedTo: result.replaced.to,
    inserted: result.inserted,
    removed: result.removed,
  };
}

/**
 * Undo/redo.
 *
 * The stack holds inverse edits rather than document snapshots, so a long
 * session costs memory proportional to what you typed rather than to the file
 * size — which matters when the whole thing is running in a phone browser tab
 * that the OS will happily evict.
 */
export class History {
  private done: Entry[] = [];
  private undone: Entry[] = [];

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }

  /**
   * Record an edit. Consecutive single-line typing inside the coalesce window
   * merges into the existing entry, so undo steps back by a word-ish chunk
   * instead of one character at a time.
   */
  record(result: EditResult, selBefore: Selection, selAfter: Selection, origin: EditOrigin): void {
    if (origin === 'history') return;
    this.undone = [];

    const last = this.done[this.done.length - 1];
    const now = Date.now();
    if (last && this.canMerge(last, result, origin, now)) {
      const change = last.changes[last.changes.length - 1];
      change.inserted += result.inserted;
      change.insertedTo = result.insertedRange.to;
      last.selAfter = selAfter;
      last.time = now;
      return;
    }

    this.done.push({ changes: [changeOf(result)], selBefore, selAfter, origin, time: now });
    if (this.done.length > MAX_DEPTH) this.done.shift();
  }

  private canMerge(last: Entry, result: EditResult, origin: EditOrigin, now: number): boolean {
    if (origin !== 'input' || last.origin !== 'input') return false;
    if (now - last.time > COALESCE_MS) return false;
    if (last.changes.length !== 1) return false;
    if (result.removed.length > 0) return false;
    // A line break ends a typing run in both directions, so pressing Enter is
    // always its own undo step rather than being swallowed by the text on
    // either side of it.
    if (/[\r\n]/.test(result.inserted)) return false;
    if (/[\r\n]/.test(last.changes[0].inserted)) return false;

    // Only merge when this edit continues exactly where the last one stopped.
    const change = last.changes[0];
    const tip = change.insertedTo;
    const start = result.replaced.from;
    return tip.line === start.line && tip.ch === start.ch;
  }

  /**
   * Pop an entry and hand it to `apply`, which is expected to run the given
   * replacements against the buffer. Returns the selection to restore.
   */
  undo(apply: (range: TextRange, text: string) => void): Selection | null {
    const entry = this.done.pop();
    if (!entry) return null;

    for (let i = entry.changes.length - 1; i >= 0; i--) {
      const change = entry.changes[i];
      apply({ from: change.from, to: change.insertedTo }, change.removed);
    }
    this.undone.push(entry);
    return entry.selBefore;
  }

  redo(apply: (range: TextRange, text: string) => void): Selection | null {
    const entry = this.undone.pop();
    if (!entry) return null;

    for (const change of entry.changes) {
      apply({ from: change.from, to: change.removedTo }, change.inserted);
    }
    this.done.push(entry);
    return entry.selAfter;
  }

  /** Force the next edit to start a fresh undo step (e.g. after a tap). */
  breakRun(): void {
    const last = this.done[this.done.length - 1];
    if (last) last.time = 0;
  }
}
