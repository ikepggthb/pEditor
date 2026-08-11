/**
 * Clipboard access, with the fallback a phone browser still needs.
 *
 * `navigator.clipboard` is the only API that can be driven from a button, but
 * it is uneven where it matters most: Firefox on Android exposes `writeText`
 * and not `readText`, and both refuse to run outside a user gesture. The
 * `execCommand` path is deprecated and works anyway, which is the whole reason
 * it is still here.
 */

/** True when a paste button has any chance of working. */
export function canReadClipboard(): boolean {
  return typeof navigator.clipboard?.readText === 'function';
}

export async function writeClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied or unavailable — fall through to the old way.
  }
  return copyViaTextarea(text);
}

export async function readClipboard(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
  } catch {
    // Permission refused, or the document is not focused.
  }
  return null;
}

/**
 * Copy by selecting text in a throwaway textarea.
 *
 * The element has to be visible enough to be selectable — `display: none` or
 * zero size makes the selection empty and the copy silently do nothing — so it
 * is parked off-screen at full opacity instead.
 */
function copyViaTextarea(text: string): boolean {
  const node = document.createElement('textarea');
  node.value = text;
  node.setAttribute('readonly', '');
  node.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;';
  document.body.appendChild(node);

  const previous = document.activeElement as HTMLElement | null;
  let copied = false;
  try {
    node.select();
    node.setSelectionRange(0, text.length);
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  node.remove();
  previous?.focus?.({ preventScroll: true });
  return copied;
}
