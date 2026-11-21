import type { Clock } from '../../../core/clock.ts'
import type { SongInfo } from 'distube'
import type { AudioCache } from '../cache.ts'
import type { StreamResolver } from '../stream.ts'
import { expect, test } from 'bun:test'
import { Song } from 'distube'
import { silentLog as log, testClock } from '../../../tests/fixtures.ts'
import { streamResolver } from '../stream.ts'
import { extractionStub, rejection } from './fakes.ts'

const SONG_WITHOUT_URL = {
  plugin: null,
  source: 'youtube',
  playFromSource: true,
  id: 'song-1',
} satisfies SongInfo

function song(overrides: Partial<SongInfo> = {}): Song {
  return new Song(
    { ...SONG_WITHOUT_URL, url: 'https://www.youtube.com/watch?v=song-1', ...overrides },
    {},
  )
}

function cacheStub(overrides: Partial<AudioCache> = {}): AudioCache {
  return {
    fileFor: async () => null,
    download: async () => '/tmp/audio/song.m4a',
    prefetch: () => {},
    dispose: () => {},
    ...overrides,
  }
}

const DOWNLOADED = 'file:///tmp/audio/song.m4a'

async function playedFrom(formats: unknown): Promise<string> {
  const resolver = streamResolver({
    cache: cacheStub({ download: async () => '/tmp/audio/song.m4a' }),
    extraction: extractionStub({ streamUrl: async () => null }),
    clock: testClock(),
    logger: log,
    beforeStream: async () => {},
  })

  resolver.remember('song-1', formats)

  return resolver.playableUrl(song())
}

test('only the progressive muxed format can be streamed', async () => {
  const formats = [
    {
      format_id: '18',
      protocol: 'https',
      acodec: 'mp4a.40.2',
      vcodec: 'avc1',
      url: 'https://video',
    },
    { format_id: '251', protocol: 'https', acodec: 'opus', vcodec: 'none', url: 'https://audio' },
  ]

  expect(await playedFrom(formats)).toBe('https://video')
})

test('an audio-only video has no direct url, so it downloads instead', async () => {
  expect(
    await playedFrom([{ protocol: 'https', acodec: 'opus', vcodec: 'none', url: 'https://audio' }]),
  ).toBe(DOWNLOADED)
})

test('storyboards and video-only formats are not streamable', async () => {
  expect(
    await playedFrom([
      { protocol: 'mhtml', acodec: 'none', vcodec: 'none', url: 'https://i.ytimg.com/sb' },
      { protocol: 'https', acodec: 'none', vcodec: 'avc1', url: 'https://video-only' },
    ]),
  ).toBe(DOWNLOADED)
})

const URL_MARGIN_MS = 5 * 60_000

function progressive(url: string) {
  return [{ protocol: 'https', acodec: 'mp4a', vcodec: 'avc1', url }]
}

function resolverAt(clock: Clock): StreamResolver {
  return streamResolver({
    cache: cacheStub(),
    extraction: extractionStub({ streamUrl: async () => 'https://cdn.test/resolved-again' }),
    clock,
    logger: log,
    beforeStream: async () => {},
  })
}

test('a stream url is reused only until it is close to expiring', async () => {
  const clock = testClock(1_700_000_000_000)
  const nowSeconds = clock.now() / 1000
  const resolver = resolverAt(clock)
  const hourLeft = `https://cdn.test/hour?expire=${nowSeconds + 3600}`

  resolver.remember('song-1', progressive(hourLeft))
  expect(await resolver.playableUrl(song())).toBe(hourLeft)

  resolver.remember('song-1', progressive(`https://cdn.test/minute?expire=${nowSeconds + 60}`))
  expect(await resolver.playableUrl(song())).toBe('https://cdn.test/resolved-again')

  expect(await resolver.playableUrl(song({ id: 'song-never-remembered' }))).toBe(
    'https://cdn.test/resolved-again',
  )
})

test('the expiry is read from the url in seconds and kept in milliseconds', async () => {
  const clock = testClock(1_700_000_000_000)
  const nowSeconds = clock.now() / 1000
  const resolver = resolverAt(clock)
  const expiring = `https://cdn.test/videoplayback?expire=${nowSeconds + 3600}`

  resolver.remember('song-1', progressive(expiring))
  clock.advance(3_600_000 - URL_MARGIN_MS - 1)
  expect(await resolver.playableUrl(song())).toBe(expiring)
  clock.advance(1)
  expect(await resolver.playableUrl(song())).toBe('https://cdn.test/resolved-again')

  resolver.remember(
    'song-2',
    progressive(`https://cdn.test/videoplayback?expire=${clock.now() / 1000 - 3600}`),
  )
  expect(await resolver.playableUrl(song({ id: 'song-2' }))).toBe('https://cdn.test/resolved-again')

  resolver.remember('song-3', progressive('https://cdn.test/videoplayback'))
  clock.advance(100 * 365 * 24 * 60 * 60_000)
  expect(await resolver.playableUrl(song({ id: 'song-3' }))).toBe('https://cdn.test/videoplayback')
})

test('a file already on disk wins over the network', async () => {
  const resolver = streamResolver({
    cache: cacheStub({ fileFor: async () => '/tmp/audio/song-1.webm' }),
    extraction: extractionStub({
      streamUrl: async () => {
        throw new Error('must not resolve a url')
      },
    }),
    clock: testClock(Date.now()),
    logger: log,
    beforeStream: async () => {},
  })

  expect(await resolver.playableUrl(song())).toBe('file:///tmp/audio/song-1.webm')
})

test('a remembered direct url is returned without asking the extractor', async () => {
  const resolver = streamResolver({
    cache: cacheStub(),
    extraction: extractionStub(),
    clock: testClock(Date.now()),
    logger: log,
    beforeStream: async () => {},
  })

  resolver.remember('song-1', [
    { protocol: 'https', acodec: 'mp4a', vcodec: 'avc1', url: 'https://cdn.test/audio' },
  ])

  expect(await resolver.playableUrl(song())).toBe('https://cdn.test/audio')
})

test('a song without an id resolves its own url, never a remembered one', async () => {
  const resolver = streamResolver({
    cache: cacheStub(),
    extraction: extractionStub({ streamUrl: async () => 'https://cdn.test/own' }),
    clock: testClock(Date.now()),
    logger: log,
    beforeStream: async () => {},
  })

  resolver.remember('', [
    { protocol: 'https', acodec: 'mp4a', vcodec: 'avc1', url: 'https://cdn.test/other' },
  ])

  expect(await resolver.playableUrl(song({ id: '' }))).toBe('https://cdn.test/own')
})

test('an unresolved direct url is asked once and cached', async () => {
  let calls = 0

  const resolver = streamResolver({
    cache: cacheStub(),
    extraction: extractionStub({
      streamUrl: async () => {
        calls++

        return `https://cdn.test/audio?expire=${Math.floor(Date.now() / 1000) + 3600}`
      },
    }),
    clock: testClock(Date.now()),
    logger: log,
    beforeStream: async () => {},
  })

  const first = await resolver.playableUrl(song())
  const second = await resolver.playableUrl(song())

  expect(first).toStartWith('https://cdn.test/audio')
  expect(second).toBe(first)
  expect(calls).toBe(1)
})

test('a direct url that failed to resolve falls back to a download', async () => {
  const resolver = streamResolver({
    cache: cacheStub({ download: async () => '/tmp/audio/song-1.m4a' }),
    extraction: extractionStub({ streamUrl: async () => null }),
    clock: testClock(Date.now()),
    logger: log,
    beforeStream: async () => {},
  })

  expect(await resolver.playableUrl(song())).toBe('file:///tmp/audio/song-1.m4a')
})

test('the stream waits for the on-air line before it starts', async () => {
  const order: Array<string> = []

  const resolver = streamResolver({
    cache: cacheStub(),
    extraction: extractionStub({
      streamUrl: async () => {
        order.push('url')

        return 'https://cdn.test/audio'
      },
    }),
    clock: testClock(Date.now()),
    logger: log,
    beforeStream: async () => {
      await Bun.sleep(10)
      order.push('line')
    },
  })

  const url = await resolver.playableUrl(song())

  order.push('stream')

  expect(url).toBe('https://cdn.test/audio')
  expect(order).toEqual(['url', 'line', 'stream'])
})

test('a slow line delays the stream, and a failed fetch still lets it finish', async () => {
  const seen: Array<string> = []
  const line = async (): Promise<void> => {
    await Bun.sleep(10)
    seen.push('line')
  }
  const resolving = streamResolver({
    cache: cacheStub(),
    extraction: extractionStub({
      streamUrl: async () => {
        seen.push('url')

        return 'https://cdn.test/a'
      },
    }),
    clock: testClock(Date.now()),
    logger: log,
    beforeStream: line,
  })
  const failing = streamResolver({
    cache: cacheStub({
      download: async () => {
        throw new Error('boom')
      },
    }),
    extraction: extractionStub(),
    clock: testClock(Date.now()),
    logger: log,
    beforeStream: line,
  })

  const url = await resolving.playableUrl(song())

  expect(url).toBe('https://cdn.test/a')
  expect(seen).toEqual(['url', 'line'])

  expect(await rejection(async () => failing.playableUrl(song()))).toBe('boom')

  expect(seen).toEqual(['url', 'line', 'line'])
})

test('a song without a url cannot be downloaded', async () => {
  const resolver = streamResolver({
    cache: cacheStub(),
    extraction: extractionStub({ streamUrl: async () => null }),
    clock: testClock(Date.now()),
    logger: log,
    beforeStream: async () => {},
  })

  expect(await rejection(async () => resolver.playableUrl(new Song(SONG_WITHOUT_URL, {})))).toMatch(
    /no url/,
  )
})

test('a forgotten url is resolved again instead of failing on a dead one', async () => {
  let calls = 0

  const resolver = streamResolver({
    cache: cacheStub(),
    extraction: extractionStub({
      streamUrl: async () => {
        calls++

        return `https://cdn.test/audio-${calls}?expire=${Math.floor(Date.now() / 1000) + 3600}`
      },
    }),
    clock: testClock(Date.now()),
    logger: log,
    beforeStream: async () => {},
  })

  const first = await resolver.playableUrl(song())

  resolver.forget('song-1')

  const resolved = await resolver.playableUrl(song())

  expect(resolved).not.toBe(first)
  expect(calls).toBe(2)
})
