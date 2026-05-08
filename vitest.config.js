import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
        'public/pages/**',       // composants UI, pas testables sans navigateur
        'public/components/**',
      ],
      reporter: ['text', 'html'],
    },
  },
});
