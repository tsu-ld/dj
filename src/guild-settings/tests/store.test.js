import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { loadSettingsStore } from '../store.js'

async function withTempStore(run) {
  const dir = await mkdtemp(join(tmpdir(), 'settings-'))
  const filePath = join(dir, 'guilds.json')

  try {
    await run(filePath, dir)
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function corruptBackups(dir) {
  const entries = await readdir(dir)

  return entries.filter(entry => entry.startsWith('guilds.json.corrupt-'))
}

test('store round-trips settings and keeps guilds independent', async () => {
  await withTempStore(async (filePath) => {
    const store = await loadSettingsStore(filePath)
    expect(store.get('a').textChannelId).toBeNull()

    const missing = store.get('missing')
    missing.textChannelId = 'mutated'
    expect(store.get('missing').textChannelId).toBeNull()

    await store.updateGuild('a', { textChannelId: '111' })
    await store.updateGuild('b', { textChannelId: '222' })

    const reloaded = await loadSettingsStore(filePath)
    expect(reloaded.get('a').textChannelId).toBe('111')
    expect(reloaded.get('b').textChannelId).toBe('222')
    expect(reloaded.get('c').textChannelId).toBeNull()
  })
})

test('changing one setting leaves the others alone', async () => {
  await withTempStore(async (filePath) => {
    const store = await loadSettingsStore(filePath)

    await store.updateGuild('a', { textChannelId: '111' })
    await store.updateGuild('a', { persona: 'un dj cumbiero' })

    const reloaded = await loadSettingsStore(filePath)
    expect(reloaded.get('a').textChannelId).toBe('111')
    expect(reloaded.get('a').persona).toBe('un dj cumbiero')
  })
})

test('concurrent writes all persist', async () => {
  await withTempStore(async (filePath) => {
    const store = await loadSettingsStore(filePath)

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => store.updateGuild(`g${i}`, { textChannelId: `c${i}` })),
    )

    const reloaded = await loadSettingsStore(filePath)
    expect(reloaded.get('g0').textChannelId).toBe('c0')
    expect(reloaded.get('g19').textChannelId).toBe('c19')
  })
})

test('corrupt JSON recovers to an empty store and keeps a backup', async () => {
  await withTempStore(async (filePath, dir) => {
    const corrupt = '{ not json'
    await writeFile(filePath, corrupt)

    const store = await loadSettingsStore(filePath)

    expect(store.get('a').textChannelId).toBeNull()

    const backups = await corruptBackups(dir)
    expect(backups).toHaveLength(1)
    expect(await readFile(join(dir, backups[0]), 'utf-8')).toBe(corrupt)
  })
})

test('wrong-shape settings recover to an empty store and keep a backup', async () => {
  const wrongShapes = ['null', '[]', '"nope"', '{"a":"nope"}', '{"a":[]}']

  for (const raw of wrongShapes) {
    await withTempStore(async (filePath, dir) => {
      await writeFile(filePath, raw)

      const store = await loadSettingsStore(filePath)

      expect(store.get('a').textChannelId).toBeNull()

      const backups = await corruptBackups(dir)
      expect(backups).toHaveLength(1)
      expect(await readFile(join(dir, backups[0]), 'utf-8')).toBe(raw)
    })
  }
})
