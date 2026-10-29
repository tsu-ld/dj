import { join } from 'node:path'
import process from 'node:process'
import { expect, test } from 'bun:test'

const ROOT = join(import.meta.dirname, '../..')

test('a missing token exits non-zero with a readable reason', async () => {
  const child = Bun.spawn([process.execPath, 'src/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, DISCORD_TOKEN: '' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const code = await child.exited
  const stderr = await new Response(child.stderr).text()

  expect(code).toBe(1)
  expect(stderr).toContain('DISCORD_TOKEN is required')
})
