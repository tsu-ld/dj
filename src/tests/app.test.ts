import type { AppConfig } from '../config.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'bun:test'
import { createApp } from '../app.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async directory => rm(directory, { recursive: true, force: true })))
})

async function config(): Promise<AppConfig> {
  const directory = await mkdtemp(join(tmpdir(), 'dj-app-'))
  directories.push(directory)

  return {
    discord: { token: 'test-token' },
    settingsPath: join(directory, 'guilds.json'),
    logLevel: 'error',
    music: {
      cacheDir: join(directory, 'audio'),
      cacheMaxBytes: 1024,
      cacheMaxAgeMs: 1_000,
      extractorCommand: 'false',
      spotify: { enabled: false },
    },
    language: { enabled: false },
    decision: { enabled: false },
    speech: { enabled: false },
    cooldowns: { plainQueryMs: 2_000, djRequestMs: 15_000 },
  }
}

test('the composition root builds every capability without a Discord login', async () => {
  const app = await createApp(await config())

  expect(app.logger).toBeDefined()

  await app.stop()
})

test('stopping twice is a no-op', async () => {
  const app = await createApp(await config())

  await app.stop()
  await app.stop()
})
