import { expect, test } from 'bun:test'
import { Playlist, Song } from 'distube'
import { MESSAGES } from '../../../messages.ts'
import { MusicCatalog } from '../catalog.ts'
import { extractionStub, log, rejection, streamStub } from './helpers.ts'

function catalogWith(
  json: (url: string, flags?: readonly string[]) => Promise<unknown> = async () => ({}),
  remember: (id: string | null | undefined, formats: unknown) => void = () => {},
): MusicCatalog {
  return new MusicCatalog({
    extraction: extractionStub({ json }),
    stream: streamStub({ remember }),
    logger: log,
  })
}

test('live and upcoming streams are marked live', () => {
  const catalog = catalogWith()

  expect(catalog.buildSong({ id: 'a', title: 'live', live_status: 'is_live' }, {}).isLive).toBe(true)
  expect(catalog.buildSong({ id: 'b', title: 'soon', live_status: 'is_upcoming' }, {}).isLive).toBe(true)
  expect(catalog.buildSong({ id: 'c', title: 'recorded', is_live: true }, {}).isLive).toBe(true)
})

test('a flat playlist entry keeps its watch url', () => {
  const song = catalogWith().buildSong({
    _type: 'url',
    id: 'abc123',
    url: 'https://www.youtube.com/watch?v=abc123',
    title: 'Related song',
  }, {})

  expect(song.url).toBe('https://www.youtube.com/watch?v=abc123')
})

test('a song maps to the queue track', () => {
  const catalog = catalogWith()
  const song = catalog.buildSong({
    id: 'abc123',
    title: 'Tema',
    duration: 181,
    thumbnail: 'https://img.test/cover.jpg',
  }, {})

  expect(catalog.trackOf(song)).toEqual({
    id: 'abc123',
    title: 'Tema',
    url: '',
    durationSeconds: 181,
    isLive: false,
    thumbnail: 'https://img.test/cover.jpg',
    requestedBy: null,
    fromRadio: false,
  })
})

test('a song without a title or url gets a safe display name', () => {
  const catalog = catalogWith()
  const track = catalog.trackOf(catalog.buildSong({ id: 'abc123' }, {}))

  expect(track.title).toBe('Unknown song')
  expect(track.url).toBe('')
  expect(track.durationSeconds).toBe(0)
})

test('a live song has no duration', () => {
  const catalog = catalogWith()
  const song = catalog.buildSong({ id: 'abc123', title: 'Live', live_status: 'is_live', duration: 90 }, {})

  expect(song.isLive).toBe(true)
  expect(song.duration).toBe(0)
  expect(catalog.trackOf(song).durationSeconds).toBe(0)
})

test('building a song remembers its direct stream url', () => {
  const remembered: unknown[] = []
  const catalog = catalogWith(undefined, (id, formats) => remembered.push({ id, formats }))
  const formats = [{ protocol: 'https', acodec: 'mp4a', vcodec: 'avc1', url: 'https://cdn.test/audio' }]

  catalog.buildSong({ id: 'abc123', title: 'Tema', formats }, {})

  expect(remembered).toEqual([{ id: 'abc123', formats }])
})

test('related songs are marked as radio and skip the current and live entries', async () => {
  const catalog = catalogWith(async () => ({
    entries: [
      { id: 'current', title: 'Now' },
      { id: 'other', title: 'Other' },
      { id: 'live', title: 'Live', live_status: 'is_live' },
    ],
  }))

  const related = await catalog.getRelatedSongs({ id: 'current' })

  expect(related.map(song => song.id)).toEqual(['other'])

  const first = related[0]

  if (!first)
    throw new Error('expected a related song')

  expect(catalog.trackOf(first).fromRadio).toBe(true)
})

test('related songs need a video id', async () => {
  expect(await catalogWith().getRelatedSongs({})).toEqual([])
})

test('related failures return an empty list', async () => {
  const catalog = catalogWith(async () => {
    throw new Error('boom')
  })

  expect(await catalog.getRelatedSongs({ id: 'current' })).toEqual([])
})

test('a playlist is resolved and its live entries are skipped', async () => {
  const catalog = catalogWith(async () => ({
    _type: 'playlist',
    id: 'PL123',
    title: 'Mix',
    webpage_url: 'https://www.youtube.com/playlist?list=PL123',
    playlist_count: 3,
    entries: [
      { id: 'a', title: 'A' },
      { id: 'live', title: 'Live', live_status: 'is_live' },
      { id: 'upcoming', title: 'Soon', live_status: 'is_upcoming' },
    ],
  }))

  const resolved = await catalog.resolve('https://www.youtube.com/playlist?list=PL123', {})

  if (!(resolved instanceof Playlist))
    throw new Error('expected a playlist')

  expect(resolved.id).toBe('PL123')
  expect(resolved.name).toBe('Mix')
  expect(resolved.songs.map(song => song.id)).toEqual(['a'])
})

test('a playlist is capped to the playlist limit', async () => {
  const entries = Array.from({ length: 60 }, (_, index) => ({ id: `song-${index}`, title: `Song ${index}` }))
  const catalog = catalogWith(async () => ({ _type: 'playlist', id: 'PL', title: 'Long', entries, playlist_count: 60 }))
  const resolved = await catalog.resolve('https://www.youtube.com/playlist?list=PL', {})

  if (!(resolved instanceof Playlist))
    throw new Error('expected a playlist')

  expect(resolved.songs).toHaveLength(50)
})

test('an empty playlist is rejected', async () => {
  const catalog = catalogWith(async () => ({ _type: 'playlist', id: 'PL', entries: [] }))

  expect(await rejection(async () => catalog.resolve('https://www.youtube.com/playlist?list=PL', {}))).toMatch(/empty/)
})

test('a playlist made only of live songs is rejected', async () => {
  const catalog = catalogWith(async () => ({
    _type: 'playlist',
    id: 'PL',
    entries: [{ id: 'live', live_status: 'is_live' }],
  }))

  expect(await rejection(async () => catalog.resolve('https://www.youtube.com/playlist?list=PL', {}))).toBe(MESSAGES.liveUnsupported)
})

test('a live video is rejected instead of queued', async () => {
  const catalog = catalogWith(async () => ({ id: 'live', title: 'Live', is_live: true }))

  expect(await rejection(async () => catalog.resolve('https://www.youtube.com/watch?v=live', {}))).toBe(MESSAGES.liveUnsupported)
})

test('a single video resolves to a song', async () => {
  const catalog = catalogWith(async () => ({ id: 'abc123', title: 'Tema', duration: 200 }))
  const resolved = await catalog.resolve('https://www.youtube.com/watch?v=abc123', {})

  if (!(resolved instanceof Song))
    throw new Error('expected a song')

  expect(resolved.id).toBe('abc123')
  expect(resolved.duration).toBe(200)
})

test('resolve rejects urls the extractor cannot handle', async () => {
  let called = false
  const catalog = catalogWith(async () => {
    called = true

    return {}
  })

  expect(await rejection(async () => catalog.resolve('https://example.com/watch?v=abc123', {}))).toBe(MESSAGES.unsupportedUrl)

  expect(called).toBe(false)
})

test('a search returns the first result', async () => {
  const catalog = catalogWith(async () => ({ entries: [{ id: 'found', title: 'Found' }, { id: 'second' }] }))
  const song = await catalog.searchSong('cumbia 2020', {})

  expect(song?.id).toBe('found')
})

test('a search without results returns null', async () => {
  const catalog = catalogWith(async () => ({ entries: [] }))

  expect(await catalog.searchSong('nothing', {})).toBeNull()
})

test('the extractor is never asked to resolve a spotify url', async () => {
  const catalog = catalogWith()

  expect(await rejection(async () => catalog.resolve('https://open.spotify.com/track/abc', {}))).toBe(MESSAGES.unsupportedUrl)
})
