import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['tests/visual_tests/**', 'node_modules/**'],
    env: { NODE_ENV: 'test' },
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/unit_tests/client/**', 'happy-dom'],
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
