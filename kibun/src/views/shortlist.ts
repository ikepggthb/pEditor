import { BY_ID } from '../dishes.ts';
import { chars, h, pad2 } from '../dom.ts';
import { figure } from '../photo.ts';
import { store } from '../store.ts';

export function shortlist(root: HTMLElement): () => void {
  function render(): void {
    const ids = store.get().shortlist;
    const n = ids.length;
    const lede = n === 0 ? 'まだ何もありません。気になった一皿を右へ送ると、ここに並びます。'
      : n === 1 ? 'ひとつだけ。これで決まり、でも、もう少し探しても。'
      : `${n}皿。眺めて、ひとつに決めましょう。`;

    root.replaceChildren(
      h('header', { class: 'mast' },
        h('a', { class: 'back', href: '#' }, '← もっと見る'),
        h('span', { class: 'dateline' }, '候補')),
      h('section', { class: 'sheet' },
        h('h1', { class: 'headline' }, '今日の候補'),
        h('p', { class: 'lede' }, lede),
        n > 0 && h('ol', { class: 'list' }, ...ids.map((id, i) => {
          const dish = BY_ID.get(id)!;
          return h('li', null,
            figure(dish, { sizes: '96px', max: 400, lazy: i > 5 }),
            h('div', { class: 'entry' },
              h('span', { class: 'num' }, pad2(i + 1)),
              h('h2', { class: 'name', style: chars(dish.name) }, dish.name),
              h('p', { class: 'en' }, dish.en),
              h('p', { class: 'actions' },
                h('button', { class: 'choose', type: 'button', onclick: () => { store.choose(id); location.hash = '#today'; } }, 'これにする'),
                h('button', { class: 'drop', type: 'button', onclick: () => store.drop(id) }, '外す'))));
        })),
        h('p', { class: 'next' },
          n >= 3 && h('a', { class: 'primary', href: '#compare' }, '二つずつ比べて決める →'),
          h('a', { href: '#' }, n ? 'もう少し探す' : '料理を見に行く'))),
    );
  }
  const off = store.subscribe(render);
  render();
  return off;
}
