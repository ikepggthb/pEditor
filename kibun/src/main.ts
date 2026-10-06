import './style.css';
import { compare } from './views/compare.ts';
import { deck } from './views/deck.ts';
import { shortlist } from './views/shortlist.ts';
import { today } from './views/today.ts';

const root = document.getElementById('app')!;
const views: Record<string, (root: HTMLElement) => () => void> = {
  '': deck,
  '#list': shortlist,
  '#compare': compare,
  '#today': today,
};

let leave = () => {};
function route(): void {
  leave();
  const view = views[location.hash] ?? deck;
  root.dataset.view = location.hash.slice(1) || 'deck';
  leave = view(root);
  scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();
