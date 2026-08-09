const REPEAT_DELAY = 320;
const REPEAT_INTERVAL = 55;

export interface KeyBinding {
  onFire: () => void;
  /** Fire repeatedly while held. For backspace and arrows, not for letters. */
  repeat?: boolean;
}

/**
 * Wire a button up as a key.
 *
 * Two things matter here and both come from `pointerdown` rather than `click`:
 * a key must act the instant it is touched, and it must not take focus — the
 * hidden textarea has to keep it, or the on-screen keyboard closes under your
 * finger mid-sentence.
 */
export function bindKey(node: HTMLElement, binding: KeyBinding): () => void {
  let delayTimer: number | null = null;
  let repeatTimer: number | null = null;

  const stop = () => {
    if (delayTimer !== null) clearTimeout(delayTimer);
    if (repeatTimer !== null) clearInterval(repeatTimer);
    delayTimer = null;
    repeatTimer = null;
    node.classList.remove('is-pressed');
  };

  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    node.classList.add('is-pressed');
    binding.onFire();
    if (!binding.repeat) return;
    delayTimer = window.setTimeout(() => {
      repeatTimer = window.setInterval(binding.onFire, REPEAT_INTERVAL);
    }, REPEAT_DELAY);
  };

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointerup', stop);
  node.addEventListener('pointercancel', stop);
  node.addEventListener('pointerleave', stop);

  return () => {
    stop();
    node.removeEventListener('pointerdown', onPointerDown);
    node.removeEventListener('pointerup', stop);
    node.removeEventListener('pointercancel', stop);
    node.removeEventListener('pointerleave', stop);
  };
}
