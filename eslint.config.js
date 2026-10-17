const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  { ignores: ['dist/', 'release/', 'src/generated/', 'node_modules/', 'src/main/resources/needle/', 'src/main/resources/sandbox-child.cjs'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
);
