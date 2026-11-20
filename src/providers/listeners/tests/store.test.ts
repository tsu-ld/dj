import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { systemClock } from '../../../core/clock.ts'
import { isRecord } from '../../../core/json.ts'
import { silentLog as log, removeTempDirs, tempDir } from '../../../tests/fixtures.ts'
import { listenersStore } from '../index.ts'

async function tempFile(name = 'listeners.json'): Promise<string> {
  return join(await tempDir(), name)
}

afterEach(removeTempDirs)

async function memberRecord(path: string, id: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  const guild = isRecord(value) ? value.g1 : undefined
  const member = isRecord(guild) ? guild[id] : undefined

  return isRecord(member) ? member : {}
}

function songsOf(member: Record<string, unknown>): Record<string, unknown> {
  return isRecord(member.songs) ? member.songs : {}
}

const ana = { id: 'u1', name: 'Ana' }
const beto = { id: 'u2', name: 'Beto' }

describe('listenersStore', () => {
  test('request counts survive flush and reload from disk', async () => {
    const path = await tempFile()
    const store = await listenersStore({ path, logger: log, clock: { now: () => 1_000 } })

    store.recordRequest('g1', ana, { title: 'Karma Police', artist: 'Radiohead' })
    store.recordRequest('g1', ana, { title: 'No Surprises', artist: 'Radiohead' })
    store.recordRequest('g1', beto, { title: 'Karma Police', artist: 'Radiohead' })

    expect(store.profile('g1', ana.id)).toEqual({
      name: 'Ana',
      requests: 2,
      topSong: null,
      topArtists: ['Radiohead'],
    })

    await store.flush()

    const reloaded = await listenersStore({ path, logger: log, clock: { now: () => 2_000 } })

    expect(reloaded.profile('g1', ana.id)?.requests).toBe(2)
    expect(reloaded.profile('g1', beto.id)?.requests).toBe(1)

    reloaded.recordRequest('g1', ana, { title: 'Karma Police', artist: 'Radiohead' })
    await reloaded.flush()

    const again = await listenersStore({ path, logger: log, clock: systemClock })

    expect(again.profile('g1', ana.id)?.requests).toBe(3)
  })

  test('a bracketed tag and the plain title are one song with count 2', async () => {
    const path = await tempFile()
    const store = await listenersStore({ path, logger: log, clock: systemClock })

    store.recordRequest('g1', ana, { title: 'Radiohead - Karma Police (Official Video)', artist: 'Radiohead' })
    store.recordRequest('g1', ana, { title: 'Radiohead - Karma Police', artist: 'Radiohead' })

    expect(store.profile('g1', ana.id)?.topSong).toEqual({ title: 'Radiohead - Karma Police', count: 2 })

    await store.flush()

    const reloaded = await listenersStore({ path, logger: log, clock: systemClock })

    expect(reloaded.profile('g1', ana.id)?.topSong).toEqual({ title: 'Radiohead - Karma Police', count: 2 })
  })

  test('a corrupt file is quarantined and the store starts empty', async () => {
    const path = await tempFile()
    await writeFile(path, '{not json')

    const store = await listenersStore({ path, logger: log, clock: systemClock })

    expect(store.profile('g1', ana.id)).toBeNull()

    store.recordRequest('g1', ana, { title: 'Karma Police', artist: 'Radiohead' })
    await store.flush()

    expect((await memberRecord(path, ana.id)).requests).toBe(1)

    const backups = (await readdir(join(path, '..'))).filter(name => name.startsWith('listeners.json.corrupt-'))

    expect(backups).toHaveLength(1)
    expect(await readFile(join(path, '..', backups[0] ?? ''), 'utf8')).toBe('{not json')
  })

  test('a member keeps at most 50 songs and the most requested survive', async () => {
    const path = await tempFile()
    const store = await listenersStore({ path, logger: log, clock: systemClock })

    for (let index = 0; index < 3; index++)
      store.recordRequest('g1', ana, { title: 'Favourite', artist: null })

    for (let index = 0; index < 54; index++)
      store.recordRequest('g1', ana, { title: `Song ${index} [Audio]`, artist: null })

    await store.flush()

    const songs = Object.keys(songsOf(await memberRecord(path, ana.id)))

    expect(songs).toHaveLength(50)
    expect(songs).toContain('favourite')

    const reloaded = await listenersStore({ path, logger: log, clock: systemClock })

    expect(reloaded.profile('g1', ana.id)?.topSong).toEqual({ title: 'Favourite', count: 3 })
  })

  test('a new song at the 50-song cap can become the top song', async () => {
    const path = await tempFile()
    const store = await listenersStore({ path, logger: log, clock: systemClock })

    for (let index = 0; index < 50; index++)
      store.recordRequest('g1', ana, { title: `Old Song ${index}`, artist: null })

    store.recordRequest('g1', ana, { title: 'Old Song 0', artist: null })

    for (let index = 0; index < 3; index++)
      store.recordRequest('g1', ana, { title: 'New Favourite', artist: null })

    expect(store.profile('g1', ana.id)?.topSong).toEqual({ title: 'New Favourite', count: 3 })

    await store.flush()

    const songs = Object.keys(songsOf(await memberRecord(path, ana.id)))

    expect(songs).toHaveLength(50)
    expect(songs).toContain('new favourite')
    expect(songs).toContain('old song 0')
    expect(songs).not.toContain('old song 1')
  })

  test('a new artist at the 20-artist cap can become the top artist', async () => {
    const path = await tempFile()
    const store = await listenersStore({ path, logger: log, clock: systemClock })

    for (let index = 0; index < 20; index++)
      store.recordRequest('g1', ana, { title: `Track ${index}`, artist: `Artist ${index}` })

    for (let index = 0; index < 2; index++)
      store.recordRequest('g1', ana, { title: 'Track 20', artist: 'New Artist' })

    expect(store.profile('g1', ana.id)?.topArtists[0]).toBe('New Artist')

    await store.flush()

    const artists = (await memberRecord(path, ana.id)).artists
    const names = isRecord(artists) ? Object.keys(artists) : []

    expect(names).toHaveLength(20)
    expect(names).toContain('New Artist')
  })

  test('a file with the old skip tallies loads and drops every field nothing reads', async () => {
    const path = await tempFile()
    const old = { name: 'Ana', requests: 3, songs: {}, artists: { Radiohead: { count: 2, lastRequested: 5 } }, skipsGiven: 4, skippedByOthers: 1, firstSeen: 7, lastSeen: 9 }

    await writeFile(path, JSON.stringify({ g1: { [ana.id]: old } }))

    const store = await listenersStore({ path, logger: log, clock: { now: () => 1_000 } })

    expect(store.profile('g1', ana.id)).toEqual({ name: 'Ana', requests: 3, topSong: null, topArtists: ['Radiohead'] })

    store.recordRequest('g1', ana, { title: 'Karma Police', artist: null })
    await store.flush()

    expect(Object.keys(await memberRecord(path, ana.id)).toSorted()).toEqual(['artists', 'lastSeen', 'name', 'requests', 'songs'])
  })
})
