import antfu from '@antfu/eslint-config'

export default antfu(
  {
    typescript: {
      tsconfigPath: './tsconfig.json',
    },
    ignores: ['docs/**'],
    rules: {
      'quotes': ['error', 'single'],
      'antfu/no-top-level-await': 'off',
      'newline-before-return': 'error',
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    // Bun's expect().rejects is a promise at runtime but its types are not
    // thenable-complete; the rule only produces false positives in tests.
    files: ['**/*.test.ts'],
    rules: { 'ts/await-thenable': 'off' },
  },
)
