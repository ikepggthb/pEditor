/**
 * Keeps the app sized to the *visual* viewport.
 *
 * When the on-screen keyboard opens, the layout viewport does not change —
 * `100vh` stays the full screen height and the bottom half of the app ends up
 * underneath the keyboard. `visualViewport` reports what is actually visible,
 * so the editor and the key bar can sit directly above the keyboard instead of
 * behind it. This is the single most important thing to get right in a mobile
 * editor; everything else is cosmetic by comparison.
 */
export function trackVisualViewport(root: HTMLElement): () => void {
  const vv = window.visualViewport;

  const applyFallback = () => {
    root.style.height = `${window.innerHeight}px`;
    root.style.transform = '';
  };

  if (!vv) {
    applyFallback();
    window.addEventListener('resize', applyFallback);
    return () => window.removeEventListener('resize', applyFallback);
  }

  let frame = 0;
  const sync = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      root.style.height = `${vv.height}px`;
      // iOS scrolls the page itself to reveal the focused field; offsetTop tells
      // us by how much, so we can push the app back into place.
      root.style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : '';
      document.documentElement.style.setProperty('--pe-vv-height', `${vv.height}px`);
    });
  };

  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  window.addEventListener('orientationchange', sync);
  sync();

  return () => {
    if (frame) cancelAnimationFrame(frame);
    vv.removeEventListener('resize', sync);
    vv.removeEventListener('scroll', sync);
    window.removeEventListener('orientationchange', sync);
  };
}

/**
 * Stop the document itself from scrolling.
 *
 * Safari will happily scroll the whole page when the keyboard appears or when a
 * touch drag reaches the end of the editor's scroller, which leaves the UI
 * half off-screen with no way back.
 */
export function lockDocumentScroll(): void {
  const reset = () => {
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  };
  window.addEventListener('scroll', reset, { passive: true });

  // Decided once per gesture, on touchstart, so the per-move handler stays
  // trivial. An earlier version keyed this off an opt-in attribute, which meant
  // every scrollable region had to remember to declare itself — and the ones
  // that forgot simply could not be scrolled at all. Asking the element whether
  // it actually scrolls cannot be forgotten.
  let gestureMayScroll = false;

  document.addEventListener(
    'touchstart',
    (event) => {
      gestureMayScroll = event.touches.length > 1 || hasScrollableAncestor(event.target as Element | null);
    },
    { passive: true },
  );

  document.addEventListener(
    'touchmove',
    (event) => {
      if (gestureMayScroll || event.touches.length > 1) return;
      event.preventDefault();
    },
    { passive: false },
  );
}

/** Whether `node` sits inside something that can actually scroll right now. */
function hasScrollableAncestor(node: Element | null): boolean {
  for (let el = node; el && el !== document.documentElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) return true;
    if (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth) return true;
  }
  return false;
}
