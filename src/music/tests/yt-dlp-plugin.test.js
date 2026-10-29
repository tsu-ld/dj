import process from 'node:process'
import { expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.js'
import { directStreamUrl, finishedAudioFile, isUrlFresh, prefetchAudio, runYtDlp, safeFileId, setBeforeStream, streamWithDjLine, urlExpiresAt, YtDlpPlugin } from '../yt-dlp-plugin.js'

test('a partially downloaded song is not playable', () => {
  const files = ['def456.m4a.part', 'abc123.webm', 'abc123.m4a.part']

  expect(finishedAudioFile(files, 'abc123')).toBe('abc123.webm')
})

test('the finished audio file is found by id', () => {
  expect(finishedAudioFile(['abc123.m4a'], 'abc123')).toBe('abc123.m4a')
})

test('files belonging to other songs are ignored', () => {
  expect(finishedAudioFile(['def456.m4a', 'abc123.m4a.part', 'xyz789.webm'], 'abc123')).toBeUndefined()
})

test('partial and legacy ytdl downloads are never played', () => {
  expect(finishedAudioFile(['abc123.webm.part'], 'abc123')).toBeUndefined()
  expect(finishedAudioFile(['abc123.webm.ytdl'], 'abc123')).toBeUndefined()
})

test('a file id is sanitized before it reaches a path', () => {
  expect(safeFileId('abc123')).toBe('abc123')
  expect(safeFileId('../../etc/passwd')).toBe('______etc_passwd')
  expect(finishedAudioFile(['abc123.m4a'], safeFileId('../abc123'))).toBeUndefined()
})

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

test('the next song is prefetched once per server, and only when yt-dlp can play it', async () => {
  const downloads = []
  let release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  const download = (url, id) => {
    downloads.push(id)

    return pending
  }

  prefetchAudio({ url: 'https://www.youtube.com/watch?v=a', id: 'a' }, 'g1', download)
  prefetchAudio({ url: 'https://www.youtube.com/watch?v=b', id: 'b' }, 'g1', download)
  prefetchAudio({ url: 'https://open.spotify.com/track/x', id: 'x' }, 'g2', download)
  prefetchAudio({ url: 'https://www.youtube.com/watch?v=c', id: 'c', isLive: true }, 'g2', download)

  expect(downloads).toEqual(['a'])

  release()
  await pending
  await new Promise(resolve => setImmediate(resolve))

  prefetchAudio({ url: 'https://www.youtube.com/watch?v=d', id: 'd' }, 'g1', download)

  expect(downloads).toEqual(['a', 'd'])

  await new Promise(resolve => setImmediate(resolve))
})

test('the stream waits for the dj line before it starts', async () => {
  const order = []
  let url

  setBeforeStream(async () => {
    await new Promise(resolve => setTimeout(resolve, 10))
    order.push('line')
  })

  try {
    const plugin = new YtDlpPlugin()
    const song = plugin.buildSong({ id: 'gate-test', title: 'Tema', formats: [{ protocol: 'https', acodec: 'mp4a.40.2', vcodec: 'avc1', url: 'https://cdn.test/audio' }] }, {})

    url = await plugin.getStreamURL(song)
    order.push('stream')
  }
  finally {
    setBeforeStream(null)
  }

  expect(url).toBe('https://cdn.test/audio')
  expect(order).toEqual(['line', 'stream'])
})

test('a slow line delays the stream, and a failed fetch still lets it finish', async () => {
  const seen = []
  const line = async () => {
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

  await expect(streamWithDjLine({}, {
    fetchUrl: async () => {
      throw new Error('boom')
    },
    line,
  })).rejects.toThrow('boom')

  expect(seen).toEqual(['url', 'line', 'line'])
})

test('a flat playlist entry keeps its watch url', () => {
  const song = new YtDlpPlugin().buildSong({ _type: 'url', id: 'abc123', url: 'https://www.youtube.com/watch?v=abc123', title: 'Related song' }, {})

  expect(song.url).toBe('https://www.youtube.com/watch?v=abc123')
})

test('live and upcoming streams are marked live', () => {
  const plugin = new YtDlpPlugin()

  expect(plugin.buildSong({ id: 'a', title: 'live', live_status: 'is_live' }, {}).isLive).toBe(true)
  expect(plugin.buildSong({ id: 'b', title: 'soon', live_status: 'is_upcoming' }, {}).isLive).toBe(true)
  expect(plugin.buildSong({ id: 'c', title: 'recorded', is_live: true }, {}).isLive).toBe(true)
})

test('resolve rejects urls the extractor cannot handle', async () => {
  await expect(new YtDlpPlugin().resolve('https://example.com/watch?v=abc123', {}))
    .rejects
    .toThrow(MESSAGES.unsupportedUrl)
})

test('related songs need a video id', async () => {
  expect(await new YtDlpPlugin().getRelatedSongs({})).toEqual([])
})

test('a hung yt-dlp process is killed at the timeout', async () => {
  await expect(runYtDlp(['-e', 'setTimeout(() => {}, 10000)'], {
    command: process.execPath,
    timeoutMs: 50,
  })).rejects.toThrow(/timed out/)
})
