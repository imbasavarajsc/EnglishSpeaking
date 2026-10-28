import { defineConfig } from 'astro/config';

// "npm run build" writes the finished site into ../static,
// which main.py already serves. main.py needs no change.
export default defineConfig({
  outDir: '../static',
  build: { format: 'file' },
  vite: {
    server: {
      proxy: { '/chat': 'http://127.0.0.1:8000' },
    },
  },
});
