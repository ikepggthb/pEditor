/**
 * King of the hill: the dish you keep stays, the next one challenges it.
 * n candidates take n−1 taps, and each tap is between just two photos.
 */
import { BY_ID } from '../dishes.ts';
import { h } from '../dom.ts';
import { figure } from '../photo.ts';
import { store } from '../store.ts';

export function compare(root: HTMLElement): () => void {
  const queue = [...store.get().shortlist];
  if (queue.length < 2) {
    location.replace('#list');
    return () => {};
  }
  let champ = queue.shift()!;
  const rounds = queue.length;

  function render(): void {
    const challenger = queue[0];
    if (!challenger) {
      store.choose(champ);
      location.replace('#today');
      return;
    }
    const side = (id: string) => {
      const dish = BY_ID.get(id)!;
      return h('button', { class: 'side', type: 'button', onclick: () => { champ = id; queue.shift(); render(); } },
        figure(dish, { sizes: '(min-width: 900px) 40vw, 50vw', max: 960, priority: 'high' }),
        h('span', { class: 'name' }, dish.name));
    };
    root.replaceChildren(
      h('header', { class: 'mast' },
        h('a', { class: 'back', href: '#list' }, '← 候補へ'),
        h('span', { class: 'dateline' }, `${rounds - queue.length + 1} / ${rounds}`)),
      h('section', { class: 'duel' },
        h('h1', { class: 'headline' }, 'どっちの気分？'),
        h('p', { class: 'lede' }, '残したいほうをタップ。'),
        h('div', { class: 'pair' }, side(champ), side(challenger))),
    );
    // Warm the next challenger so the following round appears at once.
    const after = queue[1] && BY_ID.get(queue[1]);
    if (after) figure(after, { sizes: '(min-width: 900px) 40vw, 50vw', max: 960, priority: 'low' });
  }
  render();
  return () => {};
}
