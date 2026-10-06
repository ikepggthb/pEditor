import { BY_ID } from '../dishes.ts';
import { chars, dateline, h } from '../dom.ts';
import { figure } from '../photo.ts';
import { kicker, type Pick } from '../recommend.ts';
import { store } from '../store.ts';

const SIZES = '(min-width: 900px) 55vw, 100vw';
/** Fraction of the width past which letting go counts as a decision. */
const THRESHOLD = 0.28;
const FLICK = 0.6; // px per ms

export function deck(root: HTMLElement): () => void {
  const tally = h('b');
  const table = h('div', { class: 'table' });
  const undoBtn = h('button', { class: 'undo', type: 'button', onclick: () => store.undo() }, '一つ戻す');
  const skipBtn = h('button', { class: 'skip', type: 'button', onclick: () => fling(-1) }, h('span', { 'aria-hidden': 'true' }, '←'), ' 見送る');
  const keepBtn = h('button', { class: 'keep', type: 'button', onclick: () => fling(1) }, '候補に入れる ', h('span', { 'aria-hidden': 'true' }, '→'));

  root.replaceChildren(
    h('header', { class: 'mast' },
      h('a', { class: 'brand', href: '#' }, 'Kibun'),
      h('span', { class: 'dateline' }, dateline()),
      h('a', { class: 'tally', href: '#list', 'aria-live': 'polite' }, '候補 ', tally)),
    table,
    h('nav', { class: 'verdict', 'aria-label': '判定' }, skipBtn, undoBtn, keepBtn),
  );

  /** Pages currently in the DOM, keyed by dish id, so a loaded photo is never rebuilt. */
  const pages = new Map<string, HTMLElement>();

  function page(p: Pick, top: boolean): HTMLElement {
    const dish = BY_ID.get(p.id)!;
    const from = p.reason.kind === 'near' ? BY_ID.get(p.reason.from) : undefined;
    return h('article', { class: 'page', 'data-id': p.id },
      h('div', { class: 'frame' },
        figure(dish, { sizes: SIZES, priority: top ? 'high' : 'low' }),
        h('span', { class: 'hint hint-keep', 'aria-hidden': 'true' }, '候補へ'),
        h('span', { class: 'hint hint-skip', 'aria-hidden': 'true' }, '見送り')),
      h('div', { class: 'caption' },
        h('p', { class: 'kicker' }, kicker(p.reason),
          from && h('span', { class: 'from' }, `${from.name}から`)),
        h('h2', { class: 'name', style: chars(dish.name) }, dish.name),
        h('p', { class: 'en' }, dish.en),
        h('p', { class: 'blurb' }, dish.blurb)));
  }

  function render(): void {
    const s = store.get();
    tally.textContent = String(s.shortlist.length);
    undoBtn.disabled = !store.canUndo();
    const ids = s.table.map((p) => p.id);
    for (const [id, el] of pages) {
      if (!ids.includes(id) && !el.classList.contains('gone')) { el.remove(); pages.delete(id); }
    }
    s.table.forEach((p, i) => {
      let el = pages.get(p.id);
      if (!el) {
        el = page(p, i === 0);
        pages.set(p.id, el);
        table.prepend(el); // underneath whatever is already there
      }
      el.classList.toggle('top', i === 0);
      el.setAttribute('aria-hidden', String(i !== 0));
      el.inert = i !== 0;
    });
    skipBtn.disabled = keepBtn.disabled = ids.length === 0;
    if (ids.length === 0 && !table.querySelector('.empty')) {
      table.append(h('div', { class: 'empty' },
        h('p', { class: 'kicker' }, 'ひととおり'),
        h('h2', { class: 'name' }, '全部見ました'),
        h('p', { class: 'blurb' }, h('a', { href: '#list' }, '候補から選ぶ'), ' か、 ',
          h('button', { class: 'link', type: 'button', onclick: () => store.restart() }, '最初から'))));
    } else if (ids.length) table.querySelector('.empty')?.remove();
  }

  /** Send the top page off to one side and record the verdict. */
  function fling(dir: 1 | -1): void {
    const top = store.get().table[0];
    const el = top && pages.get(top.id);
    if (!el) return;
    pages.delete(top.id);
    el.classList.replace('top', 'gone');
    el.style.transform = `translate3d(${dir * 110}%, 0, 0)`;
    el.style.setProperty('--pull', String(dir));
    const done = () => el.remove();
    el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 400); // in case no transition runs (reduced motion)
    if (dir === 1) bump();
    store.judge(dir === 1 ? 'keep' : 'skip');
  }

  function bump(): void {
    tally.classList.remove('bump');
    void tally.offsetWidth;
    tally.classList.add('bump');
  }

  // Dragging: only horizontal intent takes over; vertical movement scrolls.
  let drag: { el: HTMLElement; x: number; y: number; t: number; w: number; dx: number; on: boolean } | null = null;

  table.addEventListener('pointerdown', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('.page.top');
    if (!el || e.button !== 0) return;
    drag = { el, x: e.clientX, y: e.clientY, t: e.timeStamp, w: el.offsetWidth, dx: 0, on: false };
  });
  table.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.on) {
      if (Math.abs(e.clientY - drag.y) > 10 && Math.abs(e.clientY - drag.y) > Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 6) return;
      drag.on = true;
      drag.el.setPointerCapture(e.pointerId);
      drag.el.classList.add('dragging');
    }
    drag.dx = dx;
    drag.el.style.transform = `translate3d(${dx}px, 0, 0)`;
    drag.el.style.setProperty('--pull', (dx / (drag.w * THRESHOLD)).toFixed(3));
  });
  const release = (e: PointerEvent) => {
    if (!drag) return;
    const { el, dx, w, t, on } = drag;
    drag = null;
    if (!on) return;
    el.classList.remove('dragging');
    const v = Math.abs(dx) / Math.max(1, e.timeStamp - t);
    if (Math.abs(dx) > w * THRESHOLD || (v > FLICK && Math.abs(dx) > 30)) fling(dx > 0 ? 1 : -1);
    else { el.style.transform = ''; el.style.removeProperty('--pull'); }
  };
  table.addEventListener('pointerup', release);
  table.addEventListener('pointercancel', release);

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
    if (e.key === 'ArrowRight') fling(1);
    else if (e.key === 'ArrowLeft') fling(-1);
    else if (e.key === 'z' || e.key === 'Backspace') store.undo();
  };
  addEventListener('keydown', onKey);
  const off = store.subscribe(render);
  render();
  return () => { off(); removeEventListener('keydown', onKey); };
}
