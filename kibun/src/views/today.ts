import { BY_ID } from '../dishes.ts';
import { chars, dateline, h } from '../dom.ts';
import { figure } from '../photo.ts';
import { store } from '../store.ts';

export function today(root: HTMLElement): () => void {
  const id = store.get().chosen;
  const dish = id && BY_ID.get(id);
  if (!dish) {
    location.replace('#list');
    return () => {};
  }
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dish.name)}`;
  root.replaceChildren(
    h('article', { class: 'today' },
      h('div', { class: 'frame' }, figure(dish, { sizes: '(min-width: 900px) 55vw, 100vw', priority: 'high' })),
      h('div', { class: 'caption' },
        h('p', { class: 'kicker' }, dateline()),
        h('p', { class: 'pre' }, '今日は、'),
        h('h1', { class: 'name', style: chars(dish.name) }, dish.name),
        h('p', { class: 'blurb' }, dish.blurb),
        h('p', { class: 'next' },
          h('a', { class: 'primary', href: maps, target: '_blank', rel: 'noopener' }, '近くのお店を探す ↗'),
          h('a', { href: '#list' }, '候補に戻る'),
          h('button', { class: 'link', type: 'button', onclick: () => { store.restart(); location.hash = ''; } }, '最初から')))),
  );
  return () => {};
}
