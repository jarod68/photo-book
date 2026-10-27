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
        'routes/**/*.js',
        'public/api/**/*.js',
        'public/utils/**/*.js',
      ],
      exclude: [
        'public/pages/**',       // UI components, not testable without a browser
        'public/components/**',
      ],
      reporter: ['text', 'html'],
      // CI fails below these (measured 82.5 / 76 / 80 / 84.7 % in Oct 2026):
      // raise them as coverage grows, never lower them to get a build through.
      thresholds: { statements: 80, branches: 73, functions: 77, lines: 82 },
    },
  },
});
