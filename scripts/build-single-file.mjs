#!/usr/bin/env node
/**
 * Bundles `dist/` into one self-contained HTML file.
 *
 * The point is portability: a single file you can open from a phone's Files
 * app, drop on any static host, or mail to yourself, with no server and no
 * asset paths to get wrong. The service worker and manifest are left behind —
 * a lone file cannot register a scope — so this is the "just open it" build,
 * while `dist/` proper is the installable PWA.
 *
 * Usage: node scripts/build-single-file.mjs [outfile]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'dist', 'assets');
const outFile = process.argv[2] ?? join(root, 'dist', 'peditor.html');

const files = readdirSync(assets);
const cssFile = files.find((f) => f.endsWith('.css'));
const jsFile = files.find((f) => f.endsWith('.js'));
if (!cssFile || !jsFile) {
  console.error('dist/assets has no .css/.js bundle — run `npm run build` first.');
  process.exit(1);
}

// Embedded so the file still has an icon when saved to a phone and added to
// the home screen, with nothing else alongside it.
const icon = readFileSync(join(root, 'public', 'icons', 'icon-192.png')).toString('base64');
const css = readFileSync(join(assets, cssFile), 'utf8');
const js = readFileSync(join(assets, jsFile), 'utf8')
  // The .map file is not travelling with us.
  .replace(/\n?\/\/# sourceMappingURL=.*$/, '')
  // A literal `</script>` inside a string would close the inline script element.
  .replaceAll('</script>', '<\\/script>');

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#12141a">
<meta name="color-scheme" content="dark light">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="pEditor">
<link rel="icon" type="image/png" href="data:image/png;base64,${icon}">
<link rel="apple-touch-icon" href="data:image/png;base64,${icon}">
<title>pEditor</title>
<style>
${css}
</style>
</head>
<body>
<div id="root"></div>
<script type="module">
${js}
</script>
</body>
</html>
`;

writeFileSync(outFile, html);
console.log(`wrote ${outFile} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB, self-contained)`);
