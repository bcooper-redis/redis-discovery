import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        // Plain `project: true` only auto-discovers tsconfig.json, which
        // deliberately excludes test/ (so `tsc --noEmit` on the app itself
        // doesn't type-check tests) — leaving every test file unmatched and
        // silently unlinted. List both explicitly so test/**/*, covered only
        // by tsconfig.test.json, actually gets parsed and linted too.
        project: ['./tsconfig.json', './tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      'no-console': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'vitest.config.ts',
      'vitest.integration.config.ts',
      'src/web/public/**',
      'scripts/**',
    ],
  },
);
