/**
 * Session-mood recommendation.
 *
 * Nothing here knows who the person is. The "mood" is built only from what
 * happened in this sitting, and it fades: each earlier step counts a little
 * less, so the deck follows a mood that changes halfway through.
 *
 *   keep  → the dish's tags pull strongly toward it
 *   skip  → a faint push away (people skip for many reasons)
 *   drop  → taken back out of the shortlist: a firmer push away
 *
 * The next dish is usually the one that best fits the mood, softened by a
 * little randomness and by a penalty for looking like the last few dishes.
 * Every few dishes it deliberately takes a detour to something the mood does
 * not point at, but not to anything the person has been actively refusing.
 */
import { BY_ID, GROUP_WEIGHT, TAGS, type Dish, type Tag } from './dishes.ts';

export type Verdict = 'keep' | 'skip' | 'drop';
export interface Step { id: string; verdict: Verdict }

export type Reason =
  | { kind: 'open'; tag: Tag }
  | { kind: 'near'; tag: Tag; from: string }
  | { kind: 'detour' };

export interface Pick { id: string; reason: Reason }

export interface History {
  steps: readonly Step[];
  /** Every dish dealt so far, in order (including any still on the table). */
  dealt: readonly string[];
  shortlist: readonly string[];
  /** Dishes dealt since the last detour. */
  sinceDetour: number;
}

type Vec = Map<Tag, number>;

const DECAY = 0.9;
const PULL: Record<Verdict, number> = { keep: 1, skip: -0.18, drop: -0.5 };
/** How much looking like the last few dishes counts against a candidate. */
const CROWD = 0.6;
const JITTER = 0.22;
const RECENT = 3;

const vecs = new Map<string, Vec>();
export function vec(dish: Dish): Vec {
  let v = vecs.get(dish.id);
  if (v) return v;
  v = new Map();
  let norm = 0;
  for (const t of dish.tags) {
    const w = GROUP_WEIGHT[TAGS[t].group];
    v.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm);
  for (const [t, w] of v) v.set(t, w / norm);
  vecs.set(dish.id, v);
  return v;
}

function dot(a: Vec, b: Vec): number {
  let s = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [t, w] of small) s += w * (large.get(t) ?? 0);
  return s;
}

export function similarity(a: Dish, b: Dish): number {
  return dot(vec(a), vec(b));
}

/** The mood: a tag vector built from this session's steps, newest heaviest. */
export function mood(steps: readonly Step[]): Vec {
  const m: Vec = new Map();
  let w = 1;
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    const dish = BY_ID.get(step.id);
    if (dish) {
      const k = PULL[step.verdict] * w;
      for (const [t, v] of vec(dish)) m.set(t, (m.get(t) ?? 0) + k * v);
    }
    w *= DECAY;
  }
  return m;
}

/** How well a dish fits the mood, in roughly [-1, 1]. */
export function affinity(m: Vec, dish: Dish): number {
  let norm = 0;
  for (const w of m.values()) norm += w * w;
  return norm === 0 ? 0 : dot(m, vec(dish)) / Math.sqrt(norm);
}

export function next(dishes: readonly Dish[], h: History, rng: () => number = Math.random): Pick | null {
  const dealt = new Set(h.dealt);
  let pool = dishes.filter((x) => !dealt.has(x.id));
  if (pool.length === 0) {
    // Second time round: anything not shortlisted and not just seen.
    const recent = new Set(h.dealt.slice(-8));
    pool = dishes.filter((x) => !h.shortlist.includes(x.id) && !recent.has(x.id));
    if (pool.length === 0) return null;
  }

  // Newest first; the last dish counts most, the one before a bit less.
  const recent = h.dealt.slice(-RECENT).reverse().map((id) => BY_ID.get(id)).filter((x) => x !== undefined);
  const crowd = (x: Dish) => recent.reduce((s, r, i) => Math.max(s, similarity(x, r) * (1 - 0.2 * i)), 0);
  // Never a third noodle (or sweet, or bowl of rice) in a row, however much the mood wants it.
  const [a, b] = recent;
  const third = (x: Dish) => !!a && !!b && form(a) === form(x) && form(b) === form(x);
  if (pool.some((x) => !third(x))) pool = pool.filter((x) => !third(x));
  const kept = h.shortlist.map((id) => BY_ID.get(id)).filter((x) => x !== undefined);

  if (kept.length === 0 && !h.steps.some((s) => s.verdict === 'keep')) {
    // Nothing to go on yet: spread out across the menu.
    const best = argmax(pool, (x) => rng() - 0.9 * crowd(x));
    return { id: best.id, reason: { kind: 'open', tag: best.tags[0]! } };
  }

  const m = mood(h.steps);
  const fit = new Map(pool.map((x) => [x.id, affinity(m, x)]));

  const wantsDetour = h.sinceDetour >= 5 || (h.sinceDetour >= 3 && rng() < 0.25);
  if (wantsDetour && pool.length > 4) {
    // Away from the mood, but not toward what's being refused: skip the
    // lowest fifth, then take whatever is least like everything kept.
    const ranked = [...pool].sort((a, b) => fit.get(a.id)! - fit.get(b.id)!);
    const lo = Math.floor(ranked.length * 0.2);
    const hi = Math.max(lo + 1, Math.ceil(ranked.length * 0.6));
    const band = ranked.slice(lo, hi);
    const far = (x: Dish) => 1 - kept.reduce((s, k) => Math.max(s, similarity(x, k)), 0);
    const best = argmax(band, (x) => far(x) - CROWD * crowd(x) + 0.5 * rng());
    return { id: best.id, reason: { kind: 'detour' } };
  }

  const best = argmax(pool, (x) => fit.get(x.id)! - CROWD * crowd(x) + JITTER * rng());
  return { id: best.id, reason: because(best, kept, m) };
}

/** Name the kept dish this one follows from, and the tag they share that the mood cares about most. */
function because(dish: Dish, kept: readonly Dish[], m: Vec): Reason {
  const from = kept.length ? argmax(kept, (k) => similarity(dish, k)) : undefined;
  const shared = from ? dish.tags.filter((t) => from.tags.includes(t)) : dish.tags;
  const tags = shared.length ? shared : dish.tags;
  const tag = argmax(tags, (t) => (m.get(t) ?? 0) * GROUP_WEIGHT[TAGS[t].group]);
  return from && shared.length
    ? { kind: 'near', tag, from: from.id }
    : { kind: 'open', tag };
}

const form = (x: Dish) => x.tags.find((t) => TAGS[t].group === 'form');

function argmax<T>(xs: readonly T[], score: (x: T) => number): T {
  let best = xs[0] as T;
  let top = -Infinity;
  for (const x of xs) {
    const s = score(x);
    if (s > top) { top = s; best = x; }
  }
  return best;
}

/** The line above a dish's name. */
export function kicker(r: Reason): string {
  switch (r.kind) {
    case 'open': return TAGS[r.tag].label;
    case 'near': return TAGS[r.tag].because;
    case 'detour': return 'ここで寄り道';
  }
}
