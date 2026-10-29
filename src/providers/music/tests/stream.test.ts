import type { Clock } from '../../../core/clock.ts'
import type { AudioCache } from '../cache.ts'
import { expect, test } from 'bun:test'
import { Song } from 'distube'
import { directStreamUrl, isUrlFresh, streamResolver, streamWithDjLine, urlExpiresAt } from '../stream.ts'
import { extractionStub, log, rejection } from './helpers.ts'

function song(overrides: { id?: string, url?: string, isLive?: boolean } = {}): Song {
  return new Song({
    plugin: null,
    source: 'youtube',
    playFromSource: true,
    id: overrides.id ?? 'song-1',
    url: 'url' in overrides ? overrides.url : 'https://www.youtube.com/watch?v=song-1',
    isLive: overrides.isLive,
  }, {})
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

function fixedClock(value: { now: number }): Clock {
  return {
    now: () => value.now,
  }
}

test('only the progressive muxed format can be streamed', () => {
  const formats = [
    { format_id: '18', protocol: 'https', acodec: 'mp4a.40.2', vcodec: 'avc1', url: 'https://video' },
    { format_id: '251', protocol: 'https', acodec: 'opus', vcodec: 'none', url: 'https://audio' },
  ]

  expect(directStreamUrl(formats)).toBe('https://video')
})

test('an audio-only video has no direct url, so it downloads instead', () => {
  expect(directStreamUrl([{ protocol: 'https', acodec: 'opus', vcodec: 'none', url: 'https://audio' }])).toBeUndefined()
})

test('storyboards and video-only formats are not streamable', () => {
  expect(directStreamUrl([
    { protocol: 'mhtml', acodec: 'none', vcodec: 'none', url: 'https://i.ytimg.com/sb' },
    { protocol: 'https', acodec: 'none', vcodec: 'avc1', url: 'https://video-only' },
  ])).toBeUndefined()
})

test('a stream url is reused only until it is close to expiring', () => {
  const now = Date.now()

  expect(isUrlFresh({ url: 'https://x', expiresAt: now + 60 * 60_000 }, now)).toBe(true)
  expect(isUrlFresh({ url: 'https://x', expiresAt: now + 60_000 }, now)).toBe(false)
  expect(isUrlFresh(undefined, now)).toBe(false)
})

test('the expiry is read from the url in seconds and kept in milliseconds', () => {
  const now = Math.floor(Date.now() / 1000)

  expect(urlExpiresAt(`https://x/videoplayback?expire=${now + 3600}`)).toBe((now + 3600) * 1000)
  expect(isUrlFresh({ url: 'https://x', expiresAt: urlExpiresAt(`https://x?expire=${now + 3600}`) })).toBe(true)
  expect(isUrlFresh({ url: 'https://x', expiresAt: urlExpiresAt(`https://x?expire=${now - 3600}`) })).toBe(false)
  expect(urlExpiresAt('https://x/videoplayback')).toBe(Number.POSITIVE_INFINITY)
})

test('a file already on disk wins over the network', async () => {
  const resolver = streamResolver({
    cache: cacheStub({ fileFor: async () => '/tmp/audio/song-1.webm' }),
    extraction: extractionStub({
      streamUrl: async () => {
        throw new Error('must not resolve a url')
      },
    }),
    clock: fixedClock({ now: Date.now() }),
    logger: log,
    beforeStream: async () => {},
  })

  expect(await resolver.playableUrl(song())).toBe('file:///tmp/audio/song-1.webm')
})

test('a remembered direct url is returned without asking the extractor', async () => {
  const resolver = streamResolver({
    cache: cacheStub(),
    extraction: extractionStub(),
    clock: fixedClock({ now: Date.now() }),
    logger: log,
    beforeStream: async () => {},
  })

  resolver.remember('song-1', [{ protocol: 'https', acodec: 'mp4a', vcodec: 'avc1', url: 'https://cdn.test/audio' }])

  expect(await resolver.playableUrl(song())).toBe('https://cdn.test/audio')
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
    clock: fixedClock({ now: Date.now() }),
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
    clock: fixedClock({ now: Date.now() }),
    logger: log,
    beforeStream: async () => {},
  })

  expect(await resolver.playableUrl(song())).toBe('file:///tmp/audio/song-1.m4a')
})

test('the stream waits for the on-air line before it starts', async () => {
  const order: string[] = []

  const resolver = streamResolver({
    cache: cacheStub(),
    extraction: extractionStub({
      streamUrl: async () => {
        order.push('url')

        return 'https://cdn.test/audio'
      },
    }),
    clock: fixedClock({ now: Date.now() }),
    logger: log,
    beforeStream: async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
      order.push('line')
    },
  })

  const url = await resolver.playableUrl(song())

  order.push('stream')

  expect(url).toBe('https://cdn.test/audio')
  expect(order).toEqual(['url', 'line', 'stream'])
})

test('a slow line delays the stream, and a failed fetch still lets it finish', async () => {
  const seen: string[] = []
  const line = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 10))
    seen.push('line')
  }

  const url = await streamWithDjLine({}, {
    fetchUrl: async () => {
      seen.push('url')

      return 'https://cdn.test/a'
    },
    line,
  })

  expect(url).toBe('https://cdn.test/a')
  expect(seen).toEqual(['url', 'line'])

  expect(await rejection(async () => streamWithDjLine({}, {
    fetchUrl: async () => {
      throw new Error('boom')
    },
    line,
  }))).toBe('boom')

  expect(seen).toEqual(['url', 'line', 'line'])
})

test('a song without a url cannot be downloaded', async () => {
  const resolver = streamResolver({
    cache: cacheStub(),
    extraction: extractionStub({ streamUrl: async () => null }),
    clock: fixedClock({ now: Date.now() }),
    logger: log,
    beforeStream: async () => {},
  })

  expect(await rejection(async () => resolver.playableUrl(song({ url: undefined })))).toMatch(/no url/)
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
    clock: fixedClock({ now: Date.now() }),
    logger: log,
    beforeStream: async () => {},
  })

  const first = await resolver.playableUrl(song())
  const remembered = await resolver.playableUrl(song())

  expect(remembered).toBe(first)
  expect(calls).toBe(1)

  resolver.forget('song-1')

  const resolved = await resolver.playableUrl(song())

  expect(resolved).not.toBe(first)
  expect(calls).toBe(2)
})
