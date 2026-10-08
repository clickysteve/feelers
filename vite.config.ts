/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Relative base so the production build works from any GitHub Pages path.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
