import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true, // so a phone on the same LAN can reach the dev server
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
