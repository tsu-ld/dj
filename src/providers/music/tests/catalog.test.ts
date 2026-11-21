import type { Json, JsonRecord } from '../../../core/json.ts'
import { expect, test } from 'bun:test'
import { Song } from 'distube'
import { MESSAGES } from '../../../messages.ts'
import { silentLog as log } from '../../../tests/fixtures.ts'
import { MusicCatalog } from '../catalog.ts'
import { expectPlaylist, extractionStub, memberOf, rejection, streamStub } from './fakes.ts'

function catalogWith(
  json: (url: string, flags?: ReadonlyArray<string>) => Promise<Json> = async () => ({}),
  remember: (id: string | null, formats: unknown) => void = () => {},
): MusicCatalog {
  return new MusicCatalog({
    extraction: extractionStub({ json }),
    stream: streamStub({ remember }),
    logger: log,
  })
}

test('live and upcoming streams are marked live', () => {
  const catalog = catalogWith()

  expect(catalog.buildSong({ id: 'a', title: 'live', live_status: 'is_live' }, {}).isLive).toBe(
    true,
  )
  expect(catalog.buildSong({ id: 'b', title: 'soon', live_status: 'is_upcoming' }, {}).isLive).toBe(
    true,
  )
  expect(catalog.buildSong({ id: 'c', title: 'recorded', is_live: true }, {}).isLive).toBe(true)
})

test('a flat playlist entry keeps its watch url', () => {
  const song = catalogWith().buildSong(
    {
      _type: 'url',
      id: 'abc123',
      url: 'https://www.youtube.com/watch?v=abc123',
      title: 'Related song',
    },
    {},
  )

  expect(song.url).toBe('https://www.youtube.com/watch?v=abc123')
})

test('a song maps to the queue track', () => {
  const catalog = catalogWith()
  const song = catalog.buildSong(
    {
      id: 'abc123',
      title: 'Tema',
      duration: 181,
      thumbnail: 'https://img.test/cover.jpg',
    },
    {},
  )

  expect(catalog.trackOf(song)).toEqual({
    id: 'abc123',
    title: 'Tema',
    url: '',
    durationSeconds: 181,
    isLive: false,
    thumbnail: 'https://img.test/cover.jpg',
    requestedBy: null,
    requesterId: null,
    artist: null,
    fromRadio: false,
  })
})

test('a track names its artist, from the credit or the topic channel', () => {
  const catalog = catalogWith()
  const artistOf = (info: JsonRecord): string | null =>
    catalog.trackOf(catalog.buildSong({ id: 'a', ...info }, {})).artist

  expect(artistOf({ artist: 'Soda Stereo', uploader: 'Soda Stereo - Topic' })).toBe('Soda Stereo')
  expect(artistOf({ creator: 'Charly García', uploader: 'Some Channel' })).toBe('Charly García')
  expect(artistOf({ uploader: 'Los Redondos - Topic' })).toBe('Los Redondos')
  expect(artistOf({ channel: 'Babasónicos - Topic' })).toBe('Babasónicos')
  expect(artistOf({ uploader: 'VEVO Uploads' })).toBeNull()
  expect(artistOf({})).toBeNull()
})

test('a channel that is not a topic channel never becomes the artist', async () => {
  const catalog = catalogWith(async () => ({
    entries: [
      {
        _type: 'url',
        id: 'lyric',
        title: 'Song (Lyrics)',
        channel: '7clouds',
        uploader: '7clouds',
      },
      { _type: 'url', id: 'vevo', title: 'Creep', channel: 'RadioheadVEVO' },
    ],
  }))
  const related = await catalog.getRelatedSongs({ id: 'a' })

  expect(related.map((song) => catalog.trackOf(song).artist)).toEqual([null, null])
  expect(related.map((song) => song.uploader.name)).toEqual(['7clouds', undefined])
})

test('a spotify song keeps the artists its plugin puts in the uploader', () => {
  const catalog = catalogWith()
  const song = new Song(
    {
      plugin: null,
      source: 'spotify',
      playFromSource: false,
      id: 'sp',
      name: 'One More Time',
      uploader: { name: 'Daft Punk' },
    },
    {},
  )

  expect(catalog.trackOf(song).artist).toBe('Daft Punk')
})

test('a track keeps who asked for it, and a radio pick has no requester', async () => {
  const catalog = catalogWith(async () => ({ entries: [{ id: 'other', title: 'Other' }] }))
  const requested = catalog.trackOf(
    catalog.buildSong({ id: 'a', title: 'A' }, { member: memberOf('200000000000000007', 'tsu') }),
  )
  const [related] = await catalog.getRelatedSongs({ id: 'a' })

  if (!related) {
    throw new Error('expected a related song')
  }

  related.member = memberOf('300000000000000009', 'DJ')

  expect(requested.requesterId).toBe('200000000000000007')
  expect(requested.requestedBy).toBe('tsu')
  expect(catalog.trackOf(related).requesterId).toBeNull()
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
  const song = catalog.buildSong(
    { id: 'abc123', title: 'Live', live_status: 'is_live', duration: 90 },
    {},
  )

  expect(song.isLive).toBe(true)
  expect(song.duration).toBe(0)
  expect(catalog.trackOf(song).durationSeconds).toBe(0)
})

test('building a song remembers its direct stream url', () => {
  const remembered: Array<unknown> = []
  const catalog = catalogWith(undefined, (id, formats) => remembered.push({ id, formats }))
  const formats = [
    { protocol: 'https', acodec: 'mp4a', vcodec: 'avc1', url: 'https://cdn.test/audio' },
  ]

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

  expect(related.map((song) => song.id)).toEqual(['other'])

  const first = related[0]

  if (!first) {
    throw new Error('expected a related song')
  }

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

  const resolved = expectPlaylist(
    await catalog.resolve('https://www.youtube.com/playlist?list=PL123', {}),
  )

  expect(resolved.id).toBe('PL123')
  expect(resolved.name).toBe('Mix')
  expect(resolved.songs.map((song) => song.id)).toEqual(['a'])
})

test('a playlist is capped to the playlist limit', async () => {
  const entries = Array.from({ length: 60 }, (_, index) => ({
    id: `song-${index}`,
    title: `Song ${index}`,
  }))
  const catalog = catalogWith(async () => ({
    _type: 'playlist',
    id: 'PL',
    title: 'Long',
    entries,
    playlist_count: 60,
  }))
  const resolved = expectPlaylist(
    await catalog.resolve('https://www.youtube.com/playlist?list=PL', {}),
  )

  expect(resolved.songs).toHaveLength(50)
})

test('an empty playlist is rejected', async () => {
  const catalog = catalogWith(async () => ({ _type: 'playlist', id: 'PL', entries: [] }))

  expect(
    await rejection(async () => catalog.resolve('https://www.youtube.com/playlist?list=PL', {})),
  ).toMatch(/empty/)
})

test('a playlist made only of live songs is rejected', async () => {
  const catalog = catalogWith(async () => ({
    _type: 'playlist',
    id: 'PL',
    entries: [{ id: 'live', live_status: 'is_live' }],
  }))

  expect(
    await rejection(async () => catalog.resolve('https://www.youtube.com/playlist?list=PL', {})),
  ).toBe(MESSAGES.liveUnsupported)
})

test('a live video is rejected instead of queued', async () => {
  const catalog = catalogWith(async () => ({ id: 'live', title: 'Live', is_live: true }))

  expect(
    await rejection(async () => catalog.resolve('https://www.youtube.com/watch?v=live', {})),
  ).toBe(MESSAGES.liveUnsupported)
})

test('a single video resolves to a song', async () => {
  const catalog = catalogWith(async () => ({ id: 'abc123', title: 'Tema', duration: 200 }))
  const resolved = await catalog.resolve('https://www.youtube.com/watch?v=abc123', {})

  expect(resolved).toBeInstanceOf(Song)

  if ('songs' in resolved) {
    throw new Error('expected a song')
  }

  expect(resolved.id).toBe('abc123')
  expect(resolved.duration).toBe(200)
})

test('resolve rejects urls the extractor cannot handle', async () => {
  let called = false
  const catalog = catalogWith(async () => {
    called = true

    return {}
  })

  expect(
    await rejection(async () => catalog.resolve('https://example.com/watch?v=abc123', {})),
  ).toBe(MESSAGES.unsupportedUrl)

  expect(called).toBe(false)
})

test('a search returns the first result', async () => {
  const catalog = catalogWith(async () => ({
    entries: [{ id: 'found', title: 'Found' }, { id: 'second' }],
  }))
  const song = await catalog.searchSong('cumbia 2020', {})

  expect(song?.id).toBe('found')
})

test('a search returns the top song on youtube music, with its credited artist', async () => {
  const calls: Array<{ url: string; flags: ReadonlyArray<string> }> = []
  const catalog = catalogWith(async (url, flags = []) => {
    calls.push({ url, flags })

    return {
      entries: [
        { id: 'song', title: 'La Bestia Pop', artist: 'Patricio Rey y sus Redonditos de Ricota' },
      ],
    }
  })
  const song = await catalog.searchSong('la bestia pop & más', {})

  expect(calls).toEqual([
    {
      url: 'https://music.youtube.com/search?q=la+bestia+pop+%26+m%C3%A1s#songs',
      flags: ['--playlist-end', '1'],
    },
  ])
  expect(song && catalog.trackOf(song).artist).toBe('Patricio Rey y sus Redonditos de Ricota')
})

test('a search youtube music has no song for falls back to youtube', async () => {
  const urls: Array<string> = []
  const catalog = catalogWith(async (url) => {
    urls.push(url)

    return url.startsWith('ytsearch1:')
      ? { entries: [{ id: 'video', title: 'Meme' }] }
      : { entries: [] }
  })
  const song = await catalog.searchSong('some meme', {})

  expect(song?.id).toBe('video')
  expect(urls).toEqual([
    'https://music.youtube.com/search?q=some+meme#songs',
    'ytsearch1:some meme',
  ])
})

test('a failed youtube music search falls back to youtube', async () => {
  const catalog = catalogWith(async (url) => {
    if (!url.startsWith('ytsearch1:')) {
      throw new Error('boom')
    }

    return { entries: [{ id: 'video', title: 'Tema' }] }
  })

  expect((await catalog.searchSong('tema', {}))?.id).toBe('video')
})

test('a search without results returns null', async () => {
  const catalog = catalogWith(async () => ({ entries: [] }))

  expect(await catalog.searchSong('nothing', {})).toBeNull()
})

test('the extractor is never asked to resolve a spotify url', async () => {
  let called = false
  const catalog = catalogWith(async () => {
    called = true

    return {}
  })

  expect(
    await rejection(async () => catalog.resolve('https://open.spotify.com/track/abc', {})),
  ).toBe(MESSAGES.unsupportedUrl)
  expect(called).toBe(false)
})
