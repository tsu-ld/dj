import type { AppConfig } from '../config.ts'
import { join } from 'node:path'
import { afterEach, expect, test } from 'bun:test'
import { createApp } from '../app.ts'
import { removeTempDirs, tempDir } from './fixtures.ts'

afterEach(removeTempDirs)

async function config(): Promise<AppConfig> {
  const directory = await tempDir()

  return {
    discord: { token: 'test-token' },
    settingsPath: join(directory, 'guilds.json'),
    listenersPath: join(directory, 'listeners.json'),
    logLevel: 'error',
    music: {
      cacheDir: join(directory, 'audio'),
      cacheMaxBytes: 1024,
      cacheMaxAgeMs: 1000,
      extractorCommand: 'false',
      welcomeFile: join(directory, 'welcome.mp3'),
      metadata: { enabled: false },
    },
    language: { enabled: false },
    decision: { enabled: false },
    speech: { enabled: false },
    cooldowns: { plainRequestMs: 2000, djRequestMs: 15_000 },
  }
}

test('the composition root builds and stops twice without throwing', async () => {
  const app = await createApp(await config())

  await expect(app.stop()).resolves.toBeUndefined()
  await expect(app.stop()).resolves.toBeUndefined()
})
