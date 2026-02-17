import antfu from '@antfu/eslint-config'

export default antfu({
  rules: {
    'quotes': ['error', 'single'],
    'antfu/no-top-level-await': 'off',
    'newline-before-return': 'error',
    'no-console': 'off',
  },
})
