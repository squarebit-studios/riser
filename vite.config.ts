/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// riser.squarebitstudios.com serves from the domain root (see CNAME), so base is '/'.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // The version, baked in at build time. package.json is the single source of
  // truth; anything that shows a version reads this rather than keeping its
  // own copy, which is how the old version.json managed to drift two releases
  // behind without anyone noticing.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // three and its USD stack are large and change rarely - keeping them in
        // their own chunk means an app edit does not invalidate them in cache.
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom']
        }
      }
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts']
    }
  }
});
