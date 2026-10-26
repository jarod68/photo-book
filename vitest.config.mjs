import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['tests/visual_tests/**', 'node_modules/**'],
    env: { NODE_ENV: 'test' },
    // Two projects: server-side code in Node, browser modules in happy-dom
    // (replaces environmentMatchGlobs, which Vitest 5 dropped silently).
    projects: [
      {
        extends: true,
        test: { name: 'server', environment: 'node', include: ['tests/**/*.test.js'], exclude: ['tests/unit_tests/client/**', 'tests/visual_tests/**', 'node_modules/**'] },
      },
      {
        extends: true,
        test: { name: 'client', environment: 'happy-dom', include: ['tests/unit_tests/client/**/*.test.js'] },
      },
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
