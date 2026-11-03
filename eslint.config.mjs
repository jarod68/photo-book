// ESLint (flat config): the recommended rules, run in CI (`npm run lint`).
// Catches what tests may miss: a name declared twice, an undefined variable,
// unreachable code, a forgotten await of a promise in a condition…
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'public/vendor/**', 'playwright-report/**', 'test-results/**', 'robot-results/**', 'load-results/**'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // server, scripts: CommonJS on Node
  {
    files: ['server.js', 'routes/**/*.js', 'services/**/*.js', 'scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  // browser: ES modules (Pannellum is a global)
  {
    files: ['public/**/*.js', 'public/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser, pannellum: 'readonly' } },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } },
  },
  // tests and configs
  {
    files: ['tests/**/*.js', '*.config.*', 'tests/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  // the load test: its data and summary on Node (CommonJS), the visitors on k6
  {
    files: ['tests/load/seed.js', 'tests/load/summary.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['tests/load/browse.js'],
    languageOptions: { sourceType: 'module', globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' } },
  },
];
