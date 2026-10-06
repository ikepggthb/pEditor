// Ask the image CDN for the smallest rendition of every photo in the
// catalogue and report any that don't come back as an image.
//   npm run check:photos
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/dishes.ts', import.meta.url), 'utf8');
const rows = [...source.matchAll(/d\('([^']+)', '([^']+)'[\s\S]*?\)(?=,\n)/g)]
  .map(([row, id, name]) => ({ id, name, photo: row.match(/'(photo-[\w-]+)'/)?.[1] }));

let bad = 0;
await Promise.all(rows.map(async ({ id, name, photo }) => {
  if (!photo) return console.log(`–  ${id} (${name}): no photo, shown as a plate`);
  const url = `https://images.unsplash.com/${photo}?w=40&h=50&fit=crop&fm=jpg`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const ok = res.ok && res.headers.get('content-type')?.startsWith('image/');
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'}  ${id} (${name}): ${res.status}  https://images.unsplash.com/${photo}?w=640`);
  } catch (e) {
    bad++;
    console.log(`✗  ${id} (${name}): ${e.cause?.code ?? e.message}`);
  }
}));
console.log(bad ? `\n${bad} photo(s) failed. Those dishes fall back to their plate.` : '\nAll photos load.');
process.exitCode = bad ? 1 : 0;
