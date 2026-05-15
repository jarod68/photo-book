import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test' },
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/client/**', 'happy-dom'],
    ],
    coverage: {
      provider: 'v8',
      include: [
        'server.js',
        'services/**/*.js',
        'public/api/**/*.js',
        'public/utils/**/*.js',
      ],
      exclude: [
        'public/pages/**',       // UI components, not testable without a browser
        'public/components/**',
      ],
      reporter: ['text', 'html'],
    },
  },
});
