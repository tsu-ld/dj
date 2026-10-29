import type { Song } from 'distube'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { AudioCache } from './cache.ts'
import type { Extractor } from './extraction.ts'
import { isRecord } from '../../core/json.ts'

// ffmpeg only gets through the progressive mp4: ask for a muxed format by name.
const MUXED_FORMAT = 'b[acodec!=none][vcodec!=none]'
// A googlevideo url dies after a few hours; re-resolve well before it does.
const STREAM_URL_MARGIN_MS = 5 * 60_000

export interface StreamEntry {
  readonly url: string
  readonly expiresAt: number
}

export interface StreamResolver {
  remember: (id: string | null | undefined, formats: unknown) => void
  playableUrl: (song: Song) => Promise<string>
  dispose: () => void
}

// ffmpeg can only stream YouTube's progressive mp4: the audio-only urls answer
// 403, and a download handles those (the extractor sends what ffmpeg does not).
export function directStreamUrl(formats: unknown): string | undefined {
  const entries: readonly unknown[] = Array.isArray(formats) ? formats : []

  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.url !== 'string' || entry.url === '')
      continue

    if (entry.protocol !== 'https' || entry.acodec === 'none' || entry.vcodec === 'none')
      continue

    return entry.url
  }

  return undefined
}

export function isUrlFresh(entry: StreamEntry | undefined, now = Date.now()): entry is StreamEntry {
  if (entry === undefined || entry.url === '')
    return false

  return entry.expiresAt - now > STREAM_URL_MARGIN_MS
}

// googlevideo carries the expiry in seconds; the margin above works in ms.
export function urlExpiresAt(url: string): number {
  const expire = Number(new URL(url).searchParams.get('expire'))

  return Number.isFinite(expire) && expire > 0 ? expire * 1000 : Number.POSITIVE_INFINITY
}

// The line and the fetch run together, so the line covers the wait. The music
// still starts only after the line ends, and a song that fails to resolve lets
// the line finish before the next song takes the connection.
export async function streamWithDjLine<T>(
  song: T,
  deps: { fetchUrl: (song: T) => Promise<string>, line: (song: T) => Promise<void> },
): Promise<string> {
  const speech = deps.line(song)

  try {
    const url = await deps.fetchUrl(song)

    await speech

    return url
  }
  catch (error) {
    await speech

    throw error
  }
}

export function streamResolver(deps: {
  cache: AudioCache
  extraction: Extractor
  clock: Clock
  logger: Logger
  beforeStream: (song: Song) => Promise<void>
}): StreamResolver {
  const { cache, extraction, clock, logger } = deps
  const streamUrls = new Map<string, StreamEntry>()

  function rememberUrl(id: string, url: string): void {
    for (const [key, entry] of streamUrls) {
      if (!isUrlFresh(entry, clock.now()))
        streamUrls.delete(key)
    }

    streamUrls.set(id, { url, expiresAt: urlExpiresAt(url) })
  }

  function remember(id: string | null | undefined, formats: unknown): void {
    if (id === null || id === undefined || id === '')
      return

    const url = directStreamUrl(formats)

    if (url === undefined)
      return

    rememberUrl(id, url)
  }

  async function directUrlFor(song: Song): Promise<string | null> {
    const remembered = streamUrls.get(song.id)

    if (isUrlFresh(remembered, clock.now()))
      return remembered.url

    streamUrls.delete(song.id)

    if (song.url === undefined || song.url === '')
      return null

    const url = await extraction.streamUrl(song.url, MUXED_FORMAT)

    if (url === null)
      return null

    rememberUrl(song.id, url)

    return url
  }

  async function waitForTheDj(song: Song): Promise<void> {
    try {
      await deps.beforeStream(song)
    }
    catch (error) {
      logger.error('music.line_failed', error)
    }
  }

  async function playableUrl(song: Song): Promise<string> {
    const file = await cache.fileFor(song.id)

    if (file !== null)
      return `file://${file}`

    const url = await directUrlFor(song).catch((error: unknown) => {
      logger.warn('music.stream_url_failed', { songId: song.id, error: error instanceof Error ? error.message : String(error) })

      return null
    })

    if (url !== null)
      return url

    if (song.url === undefined || song.url === '')
      throw new Error('The song has no url to download.')

    return `file://${await cache.download(song.url, song.id)}`
  }

  async function resolvePlayableUrl(song: Song): Promise<string> {
    return streamWithDjLine(song, { fetchUrl: playableUrl, line: waitForTheDj })
  }

  return {
    remember,
    playableUrl: resolvePlayableUrl,
    dispose() {
      streamUrls.clear()
    },
  }
}
