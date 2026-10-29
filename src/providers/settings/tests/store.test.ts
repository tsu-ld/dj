import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { logger } from '../../../core/logger.ts'
import { settingsStore } from '../index.ts'

const directories: string[] = []

async function tempFile(name = 'guilds.json'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dj-settings-'))
  directories.push(directory)

  return join(directory, name)
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(async directory => rm(directory, { recursive: true, force: true })))
})

const log = logger({ level: 'error', sink: () => {} })

describe('settingsStore', () => {
  test('a missing file starts empty and returns defaults', async () => {
    const store = await settingsStore({ path: await tempFile(), logger: log })

    expect(store.get('g1')).toEqual({ textChannelId: null, persona: null })
  })

  test('an update is persisted and read back', async () => {
    const path = await tempFile()
    const store = await settingsStore({ path, logger: log })

    await store.update('g1', { textChannelId: '123' })
    await store.flush()

    const reloaded = await settingsStore({ path, logger: log })

    expect(reloaded.get('g1')).toEqual({ textChannelId: '123', persona: null })
  })

  test('a legacy entry with only one field keeps that field and defaults the rest', async () => {
    const path = await tempFile()
    await writeFile(path, JSON.stringify({ g1: { textChannelId: '9' }, g2: { persona: 'un dj' } }))
    const store = await settingsStore({ path, logger: log })

    expect(store.get('g1')).toEqual({ textChannelId: '9', persona: null })
    expect(store.get('g2')).toEqual({ textChannelId: null, persona: 'un dj' })
  })

  test('one bad legacy entry does not quarantine the good guilds', async () => {
    const path = await tempFile()
    await writeFile(path, JSON.stringify({ g1: { persona: 'un dj' }, bad: 'nope' }))
    const store = await settingsStore({ path, logger: log })

    expect(store.get('g1').persona).toBe('un dj')
    expect(store.get('bad')).toEqual({ textChannelId: null, persona: null })
  })

  test('a legacy bare map is migrated in memory and on the next write', async () => {
    const path = await tempFile()
    await writeFile(path, JSON.stringify({ g1: { textChannelId: '9', persona: 'un dj' } }))
    const store = await settingsStore({ path, logger: log })

    expect(store.get('g1')).toEqual({ textChannelId: '9', persona: 'un dj' })

    await store.update('g2', { persona: 'otro' })
    await store.flush()

    const saved = JSON.parse(await readFile(path, 'utf8')) as { version: number, guilds: Record<string, unknown> }

    expect(saved.version).toBe(1)
    expect(saved.guilds.g1).toEqual({ textChannelId: '9', persona: 'un dj' })
  })

  test('a corrupt file is quarantined and replaced with an empty store', async () => {
    const path = await tempFile()
    await writeFile(path, '{not json')
    const store = await settingsStore({ path, logger: log })

    expect(store.get('g1')).toEqual({ textChannelId: null, persona: null })

    await store.update('g1', { persona: 'un dj' })
    await store.flush()

    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: 1 })

    const backups = (await readdir(join(path, '..'))).filter(name => name.startsWith('guilds.json.corrupt-'))

    expect(backups).toHaveLength(1)
    expect(await readFile(join(path, '..', backups[0] ?? ''), 'utf8')).toBe('{not json')
  })

  test('a wrong shape is quarantined, never read as guilds', async () => {
    for (const content of ['null', '[]', '"nope"', '{"a":"nope"}', '{"a":[]}']) {
      const path = await tempFile()

      await writeFile(path, content)

      const store = await settingsStore({ path, logger: log })

      expect(store.get('a')).toEqual({ textChannelId: null, persona: null })
      expect((await readdir(join(path, '..'))).some(name => name.startsWith('guilds.json.corrupt-'))).toBe(true)
    }
  })

  test('concurrent updates keep every guild', async () => {
    const path = await tempFile()
    const store = await settingsStore({ path, logger: log })

    await Promise.all([
      store.update('g1', { persona: 'uno' }),
      store.update('g2', { persona: 'dos' }),
      store.update('g3', { persona: 'tres' }),
    ])
    await store.flush()

    const reloaded = await settingsStore({ path, logger: log })

    expect(reloaded.get('g1').persona).toBe('uno')
    expect(reloaded.get('g2').persona).toBe('dos')
    expect(reloaded.get('g3').persona).toBe('tres')
  })
})
