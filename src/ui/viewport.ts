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
  // Nothing here may register a non-passive `touchmove`. Such a listener forces
  // the browser to wait for JavaScript before it can move a single pixel, which
  // turns every flick into visible stutter. The page is pinned with CSS instead
  // — `overflow: hidden` and `overscroll-behavior: none` on the document, and
  // `overscroll-behavior: contain` on each scroller — so scrolling stays on the
  // compositor where it belongs.
  const reset = () => {
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  };
  window.addEventListener('scroll', reset, { passive: true });
}
