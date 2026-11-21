import type { Song } from 'distube'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { AudioCache } from './cache.ts'
import type { Extractor } from './extraction.ts'
import { errorMessage } from '../../core/errors.ts'
import { isRecord } from '../../core/json.ts'

const STREAM_URL_EXPIRY_MARGIN_MS = 5 * 60_000

interface StreamEntry {
  readonly url: string
  readonly expiresAt: number
}

export interface StreamResolver {
  remember: (id: string | null, formats: unknown) => void
  forget: (id: string) => void
  playableUrl: (song: Song) => Promise<string>
  dispose: () => void
}

// WORKAROUND(https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide): YouTube answers ffmpeg 403 on audio-only media URLs from the default clients, while the progressive mp4 plays; only a progressive URL is remembered. Goes when audio-only URLs play.
function directStreamUrl(formats: unknown): string | undefined {
  const entries: ReadonlyArray<unknown> = Array.isArray(formats) ? formats : []

  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.url !== 'string' || entry.url === '') {
      continue
    }

    if (entry.protocol !== 'https' || entry.acodec === 'none' || entry.vcodec === 'none') {
      continue
    }

    return entry.url
  }

  return undefined
}

function isUrlFresh(entry: StreamEntry | undefined, now: number): entry is StreamEntry {
  if (entry === undefined) {
    return false
  }

  return entry.expiresAt - now > STREAM_URL_EXPIRY_MARGIN_MS
}

function urlExpiresAt(url: string): number {
  const expire = Number(new URL(url).searchParams.get('expire'))

  return Number.isFinite(expire) && expire > 0 ? expire * 1000 : Number.POSITIVE_INFINITY
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
      if (!isUrlFresh(entry, clock.now())) {
        streamUrls.delete(key)
      }
    }

    streamUrls.set(id, { url, expiresAt: urlExpiresAt(url) })
  }

  function remember(id: string | null, formats: unknown): void {
    if (id === null || id === '') {
      return
    }

    const url = directStreamUrl(formats)

    if (url === undefined) {
      return
    }

    rememberUrl(id, url)
  }

  async function directUrlFor(song: Song): Promise<string | null> {
    const remembered = streamUrls.get(song.id)

    if (isUrlFresh(remembered, clock.now())) {
      return remembered.url
    }

    streamUrls.delete(song.id)

    if (song.url === undefined || song.url === '') {
      return null
    }

    const url = await extraction.streamUrl(song.url)

    if (url === null) {
      return null
    }

    rememberUrl(song.id, url)

    return url
  }

  async function waitForTheDj(song: Song): Promise<void> {
    try {
      await deps.beforeStream(song)
    } catch (error) {
      logger.error('music.line_failed', error)
    }
  }

  async function playableUrl(song: Song): Promise<string> {
    const file = await cache.fileFor(song.id)

    if (file !== null) {
      return `file://${file}`
    }

    const url = await directUrlFor(song).catch((error: unknown) => {
      logger.warn('music.stream_url_failed', { songId: song.id, error: errorMessage(error) })

      return null
    })

    if (url !== null) {
      return url
    }

    if (song.url === undefined || song.url === '') {
      throw new Error('The song has no url to download.')
    }

    return `file://${await cache.download(song.url, song.id)}`
  }

  async function playableUrlAfterTheDj(song: Song): Promise<string> {
    const speech = waitForTheDj(song)

    try {
      const url = await playableUrl(song)

      await speech

      return url
    } catch (error) {
      await speech

      throw error
    }
  }

  return {
    remember,
    forget(id) {
      streamUrls.delete(id)
    },
    playableUrl: playableUrlAfterTheDj,
    dispose() {
      streamUrls.clear()
    },
  }
}
