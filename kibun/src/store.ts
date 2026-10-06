/**
 * The session. Kept in sessionStorage on purpose: the mood belongs to this
 * sitting, so closing the tab forgets it, and nothing builds up over days.
 */
import { BY_ID, DISHES } from './dishes.ts';
import { next, type History, type Pick, type Verdict } from './recommend.ts';

export interface State extends History {
  /** The dish on top, and the one underneath (already loading). */
  table: Pick[];
  chosen: string | null;
}

const KEY = 'kibun:v1';

function fresh(): State {
  const s: State = { steps: [], dealt: [], shortlist: [], sinceDetour: 0, table: [], chosen: null };
  deal(s);
  deal(s);
  return s;
}

function deal(s: State): void {
  const p = next(DISHES, s);
  if (!p) return;
  s.table.push(p);
  s.dealt = [...s.dealt, p.id];
  s.sinceDetour = p.reason.kind === 'detour' ? 0 : s.sinceDetour + 1;
}

function load(): State {
  try {
    const raw = sessionStorage.getItem(KEY);
    const s = raw && (JSON.parse(raw) as State);
    // A dish that has since left the catalogue would break the page: start over.
    if (s && [...s.dealt, ...s.shortlist].every((id) => BY_ID.has(id))) return s;
  } catch { /* private mode, or a stale shape: start over */ }
  return fresh();
}

let state = load();
let undo: string | null = null;
const listeners = new Set<() => void>();

function commit(s: State, undoable = false): void {
  undo = undoable ? JSON.stringify(state) : null;
  state = s;
  try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not fatal */ }
  for (const f of listeners) f();
}

export const store = {
  get: (): Readonly<State> => state,
  subscribe(f: () => void): () => void {
    listeners.add(f);
    return () => listeners.delete(f);
  },
  canUndo: () => undo !== null,

  /** Judge the dish on top, then deal one more underneath. */
  judge(verdict: Exclude<Verdict, 'drop'>): void {
    const top = state.table[0];
    if (!top) return;
    const s: State = structuredClone(state);
    s.table.shift();
    s.steps = [...s.steps, { id: top.id, verdict }];
    if (verdict === 'keep' && !s.shortlist.includes(top.id)) s.shortlist = [...s.shortlist, top.id];
    deal(s);
    commit(s, true);
  },

  drop(id: string): void {
    const s: State = structuredClone(state);
    s.shortlist = s.shortlist.filter((x) => x !== id);
    s.steps = [...s.steps, { id, verdict: 'drop' }];
    commit(s, true);
  },

  choose(id: string | null): void {
    commit({ ...state, chosen: id });
  },

  undo(): void {
    if (undo) commit(JSON.parse(undo) as State);
  },

  restart(): void {
    commit(fresh());
  },
};
