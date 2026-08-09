import './styles/base.css';
import './styles/theme.css';
import './styles/editor.css';
import './styles/ui.css';
import { App } from './ui/app.ts';

const host = document.getElementById('root');
if (!host) throw new Error('#root is missing from index.html');

new App(host).mount();

// The service worker is what makes the editor open instantly and work offline —
// the point of installing it to the home screen in the first place.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    // Registered from `public/`, so it lands next to index.html and its scope
    // covers the whole app.
    void navigator.serviceWorker.register('./sw.js').catch(() => {
      /* Offline support is a bonus; a failed registration must not break boot. */
    });
  });
}
