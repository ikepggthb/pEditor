import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BY_ID, DISHES, TAGS } from '../src/dishes.ts';
import { affinity, mood, next, similarity, type History, type Pick, type Step } from '../src/recommend.ts';

/** Deterministic rng so runs are repeatable. */
function seeded(seed: number): () => number {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Play a session: keep whatever `likes` accepts, skip the rest. */
function play(likes: (id: string) => boolean, n: number, seed = 1): Pick[] {
  const rng = seeded(seed);
  const h: History & { steps: Step[]; dealt: string[]; shortlist: string[] } =
    { steps: [], dealt: [], shortlist: [], sinceDetour: 0 };
  const out: Pick[] = [];
  for (let i = 0; i < n; i++) {
    const p = next(DISHES, h, rng);
    if (!p) break;
    out.push(p);
    h.dealt.push(p.id);
    h.sinceDetour = p.reason.kind === 'detour' ? 0 : h.sinceDetour + 1;
    const keep = likes(p.id);
    h.steps.push({ id: p.id, verdict: keep ? 'keep' : 'skip' });
    if (keep) h.shortlist.push(p.id);
  }
  return out;
}

const has = (tag: string) => (id: string) => BY_ID.get(id)!.tags.includes(tag as never);

test('catalogue is well-formed', () => {
  // tags[0] is the cuisine and tags[1] the form, by convention.
  assert.equal(new Set(DISHES.map((d) => d.id)).size, DISHES.length);
  for (const d of DISHES) {
    for (const t of d.tags) assert.ok(TAGS[t], `${d.id}: unknown tag ${t}`);
    assert.equal(TAGS[d.tags[0]!].group, 'cuisine', `${d.id}: first tag should be its cuisine`);
    assert.equal(TAGS[d.tags[1]!].group, 'form', `${d.id}: second tag should be its form`);
    assert.equal(d.tags.filter((t) => TAGS[t].group === 'form').length, 1, `${d.id}: one form only`);
    assert.match(d.tone, /^#[0-9a-f]{6}$/);
  }
});

test('similarity is 1 with itself and symmetric', () => {
  const [a, b] = [BY_ID.get('ramen')!, BY_ID.get('udon')!];
  assert.ok(Math.abs(similarity(a, a) - 1) < 1e-9);
  assert.equal(similarity(a, b), similarity(b, a));
  assert.ok(similarity(a, b) > similarity(a, BY_ID.get('parfait')!));
});

test('the opening hand spreads across cuisines', () => {
  const first = play(() => false, 8).map((p) => BY_ID.get(p.id)!.tags[0]);
  assert.ok(new Set(first).size >= 6, `only ${new Set(first).size} cuisines in ${first}`);
});

test('the newest keep outweighs older ones', () => {
  const m = mood([{ id: 'parfait', verdict: 'keep' }, { id: 'ramen', verdict: 'keep' }]);
  assert.ok(affinity(m, BY_ID.get('udon')!) > affinity(m, BY_ID.get('pancakes')!));
});

test('keeping noodles makes noodles more likely', () => {
  const noodle = has('noodle');
  const base = DISHES.filter((d) => noodle(d.id)).length / DISHES.length;
  let hits = 0, total = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const picks = play(noodle, 24, seed);
    const after = picks.slice(picks.findIndex((p) => noodle(p.id)) + 1, 14);
    hits += after.filter((p) => noodle(p.id)).length;
    total += after.length;
  }
  assert.ok(hits / total > base * 1.5, `noodle rate ${(hits / total).toFixed(2)} vs base ${base.toFixed(2)}`);
});

test('a strong mood still gets detours, and never three of a kind in a row', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const picks = play(has('sweet'), 30, seed);
    assert.ok(picks.some((p) => p.reason.kind === 'detour'), `seed ${seed}: no detour`);
    for (let i = 2; i < picks.length; i++) {
      const ids = [picks[i - 2]!, picks[i - 1]!, picks[i]!].map((p) => BY_ID.get(p.id)!);
      assert.ok(!ids.every((d) => d.tags[1] === ids[0]!.tags[1]),
        `seed ${seed}: ${ids.map((d) => d.id)} are the same kind of dish three times`);
    }
  }
});

test('nothing repeats until the menu runs out, then shortlisted dishes stay out', () => {
  const picks = play(has('jp'), DISHES.length + 10);
  const firstLap = picks.slice(0, DISHES.length).map((p) => p.id);
  assert.equal(new Set(firstLap).size, DISHES.length);
  for (const p of picks.slice(DISHES.length)) assert.ok(!has('jp')(p.id), `${p.id} came back`);
});

test('a near pick names a kept dish it shares a tag with', () => {
  for (const p of play(has('it'), 20)) {
    if (p.reason.kind !== 'near') continue;
    const from = BY_ID.get(p.reason.from)!;
    assert.ok(from.tags.includes(p.reason.tag) && BY_ID.get(p.id)!.tags.includes(p.reason.tag));
  }
});
