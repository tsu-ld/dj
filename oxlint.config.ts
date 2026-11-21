import cloudflare from '@cloudflare/oxlint-config'
import { defineConfig } from 'oxlint'

export default defineConfig({
  ...cloudflare,
  ignorePatterns: [
    ...(cloudflare.ignorePatterns ?? []),
    '.agent/**',
    '.agents/**',
    '.claude/**',
    '.codex/**',
    '.cursor/**',
    '.opencode/**',
  ],
  jsPlugins: [...(cloudflare.jsPlugins ?? []), { name: 'local', specifier: './local-rules.js' }],
  overrides: [
    ...(cloudflare.overrides ?? []),
    { files: ['e2e-test.ts'], rules: { 'no-console': 'off' } },
    {
      // WORKAROUND(https://github.com/oven-sh/bun/issues/47556): bun-types 1.4.5 types the rejects and resolves matchers as void, so awaiting them is reported; remove when a release types them as promises.
      files: ['**/*.test.ts'],
      rules: { 'typescript/await-thenable': 'off' },
    },
    {
      files: ['src/**/tests/**'],
      rules: {
        'quality/no-chained-type-assertions': 'off',
        'typescript/no-unsafe-type-assertion': 'off',
      },
    },
  ],
  rules: {
    ...cloudflare.rules,
    'local/no-comments': 'error',
    'local/no-em-dash': 'error',
  },
})
