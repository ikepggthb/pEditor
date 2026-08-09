import type { EditorConfig } from '../editor/core/editor.ts';

const DOC_KEY = 'peditor.document.v1';
const SETTINGS_KEY = 'peditor.settings.v1';

export interface PersistedDocument {
  name: string;
  text: string;
  languageId: string;
  savedAt: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled (private browsing). Losing the
    // autosave is bad but not worth taking the editor down for.
  }
}

export function loadDocument(): PersistedDocument | null {
  return read<PersistedDocument>(DOC_KEY);
}

export function saveDocument(doc: PersistedDocument): void {
  write(DOC_KEY, doc);
}

export function loadSettings(): Partial<EditorConfig> | null {
  return read<Partial<EditorConfig>>(SETTINGS_KEY);
}

export function saveSettings(config: EditorConfig): void {
  write(SETTINGS_KEY, config);
}

/** Run `fn` once `delay` has passed with no further calls. */
export function debounce(fn: () => void, delay: number): () => void {
  let timer: number | null = null;
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      fn();
    }, delay);
  };
}

/** Run `fn` immediately, then at most once per `interval` while called. */
export function throttle(fn: () => void, interval: number): () => void {
  let last = 0;
  let timer: number | null = null;
  return () => {
    const now = Date.now();
    const wait = interval - (now - last);
    if (wait <= 0) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      last = now;
      fn();
    } else if (timer === null) {
      timer = window.setTimeout(() => {
        timer = null;
        last = Date.now();
        fn();
      }, wait);
    }
  };
}
