/**
 * Every photo is cropped by the image CDN to the same 4:5 frame and served in
 * whatever format the browser accepts best (AVIF/WebP). The browser picks one
 * width from `srcset`, so a phone never downloads a desktop-sized file and a
 * thumbnail never downloads the full one.
 */
import type { Dish } from './dishes.ts';

const BASE = 'https://images.unsplash.com/';
const WIDTHS = [240, 400, 640, 960, 1280] as const;

export function src(photo: string, w: number): string {
  const h = Math.round(w * 1.25);
  return `${BASE}${photo}?auto=format&fit=crop&crop=entropy&w=${w}&h=${h}&q=${w > 640 ? 55 : 65}`;
}

export function srcset(photo: string, max = 1280): string {
  return WIDTHS.filter((w) => w <= max).map((w) => `${src(photo, w)} ${w}w`).join(', ');
}

export interface PhotoOptions {
  sizes: string;
  /** Largest width worth offering for this slot. */
  max?: number;
  priority?: 'high' | 'low' | 'auto';
  lazy?: boolean;
}

/**
 * A <figure> painted in the dish's tone, with its name set large underneath
 * the image. If there is no photo, or it fails, the name is what you see.
 */
export function figure(dish: Dish, opts: PhotoOptions): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'photo';
  fig.style.backgroundColor = dish.tone;
  fig.style.setProperty('--chars', String([...dish.name].length));
  const plate = document.createElement('span');
  plate.className = 'plate';
  plate.setAttribute('aria-hidden', 'true');
  plate.textContent = dish.name;
  fig.append(plate);

  if (dish.photo) {
    const img = new Image();
    img.alt = dish.name;
    img.decoding = 'async';
    img.loading = opts.lazy ? 'lazy' : 'eager';
    img.fetchPriority = opts.priority ?? 'auto';
    img.sizes = opts.sizes;
    img.srcset = srcset(dish.photo, opts.max);
    img.src = src(dish.photo, 640);
    const shown = () => fig.classList.add('loaded');
    if (img.complete && img.naturalWidth) shown();
    else {
      img.addEventListener('load', shown, { once: true });
      img.addEventListener('error', () => img.remove(), { once: true });
    }
    fig.append(img);
  }
  return fig;
}
