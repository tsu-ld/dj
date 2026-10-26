import { expect, test } from 'bun:test'
import { MESSAGES } from '../../messages/en.js'
import { assertSupportedMusicUrl, assertYtDlpUrl, isSupportedMusicUrl, isUrlLike, liveError } from '../yt-dlp-policy.js'

const SUPPORTED_URLS = [
  'https://youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtu.be/dQw4w9WgXcQ',
  'https://youtube-nocookie.com/embed/dQw4w9WgXcQ',
  'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
]

const REJECTED_URLS = [
  'http://127.0.0.1:8080/audio',
  'http://10.0.0.1/audio',
  'http://172.16.0.1/audio',
  'http://192.168.1.10/audio',
  'http://169.254.169.254/latest/meta-data',
  'http://localhost/audio',
  'http://0.0.0.0/audio',
  'http://[::1]/audio',
  'http://printer.local/audio',
  'file:///etc/passwd',
  'https://example.com/watch?v=dQw4w9WgXcQ',
  'https://spotify.link/abc123',
]

function thrownCode(run) {
  try {
    run()
  }
  catch (error) {
    return error.code
  }

  return null
}

test('youtube and spotify links are supported', () => {
  for (const url of SUPPORTED_URLS) {
    expect(isUrlLike(url)).toBe(true)
    expect(isSupportedMusicUrl(url)).toBe(true)
    expect(() => assertSupportedMusicUrl(url)).not.toThrow()
  }
})

test('private hosts, other sites and file urls are rejected', () => {
  for (const url of REJECTED_URLS) {
    expect(isSupportedMusicUrl(url)).toBe(false)
    expect(() => assertSupportedMusicUrl(url)).toThrow(MESSAGES.unsupportedUrl)
    expect(thrownCode(() => assertSupportedMusicUrl(url))).toBe('UNSUPPORTED_URL')
  }
})

test('plain search text is not a url and passes through', () => {
  for (const text of ['never gonna give you up', 'cumbia 2020', 'youtube.com/watch?v=dQw4w9WgXcQ']) {
    expect(isUrlLike(text)).toBe(false)
    expect(() => assertSupportedMusicUrl(text)).not.toThrow()
  }
})

test('yt-dlp only accepts youtube urls', () => {
  expect(() => assertYtDlpUrl('https://youtu.be/dQw4w9WgXcQ')).not.toThrow()
  expect(() => assertYtDlpUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')).toThrow(MESSAGES.unsupportedUrl)
  expect(() => assertYtDlpUrl('file:///etc/passwd')).toThrow(MESSAGES.unsupportedUrl)
  expect(thrownCode(() => assertYtDlpUrl('https://example.com'))).toBe('UNSUPPORTED_URL')
})

test('a live stream carries its own failure code', () => {
  const error = liveError()

  expect(error.message).toBe(MESSAGES.liveUnsupported)
  expect(error.code).toBe('LIVE_UNSUPPORTED')
  expect(error.errorCode).toBe('LIVE_UNSUPPORTED')
})
