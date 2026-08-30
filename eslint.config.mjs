import eslint from '@eslint/js';

export default [
  {
    ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/*.ts', '**/*.tsx'],
  },
  eslint.configs.recommended,
];
