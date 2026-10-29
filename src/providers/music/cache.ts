import type { Logger } from '../../core/logger.ts'
import type { Extractor } from './extraction.ts'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isYoutubeUrl } from './policy.ts'

export interface PrefetchCandidate {
  readonly id: string
  readonly url?: string | null
  readonly isLive?: boolean
}

export interface AudioCache {
  fileFor: (id: string) => Promise<string | null>
  download: (url: string, id: string) => Promise<string>
  // The next track downloads while the current one plays, so from the second
  // song on the queue reads from disk. One prefetch per guild at a time; a
  // Spotify song resolves to YouTube only when it starts, so it cannot be
  // prefetched from its own URL.
  prefetch: (candidate: PrefetchCandidate | null | undefined, guildId: string, download?: (url: string, id: string) => Promise<unknown>) => void
  dispose: () => void
}

// yt-dlp leaves <id>.<ext>.part (and .ytdl) files behind mid-download;
// only a finished file may be played.
export function finishedAudioFile(files: readonly string[], id: string): string | undefined {
  return files.find(file => file.startsWith(`${id}.`) && !file.endsWith('.part') && !file.endsWith('.ytdl'))
}

// The id comes from an external service and ends up in a path; keep only word
// characters and dashes so it can never walk out of the audio directory.
export function safeFileId(id: unknown): string {
  return String(id ?? '').replace(/[^\w-]/g, '_')
}

export function audioCache(deps: {
  dir: string
  maxBytes: number
  maxAgeMs: number
  extraction: Extractor
  logger: Logger
}): AudioCache {
  const { dir, maxBytes, maxAgeMs, extraction, logger } = deps
  const downloads = new Map<string, Promise<string>>()
  const prefetching = new Set<string>()
  let disposed = false

  async function filesIn(dirPath: string): Promise<string[]> {
    return readdir(dirPath).catch(() => [])
  }

  async function fileFor(id: string): Promise<string | null> {
    const file = finishedAudioFile(await filesIn(dir), safeFileId(id))

    return file === undefined ? null : join(dir, file)
  }

  async function cleanOldFiles(): Promise<void> {
    const now = Date.now()
    const kept: Array<{ path: string, size: number, mtimeMs: number }> = []
    let removedBytes = 0

    for (const file of await filesIn(dir)) {
      const path = join(dir, file)
      const info = await stat(path).catch(() => null)

      if (!info?.isFile())
        continue

      if (now - info.mtimeMs > maxAgeMs) {
        await rm(path, { force: true })
        removedBytes += info.size
        continue
      }

      // Partial downloads belong to a process that may still be writing them.
      if (!file.endsWith('.part') && !file.endsWith('.ytdl'))
        kept.push({ path, size: info.size, mtimeMs: info.mtimeMs })
    }

    let totalBytes = kept.reduce((sum, file) => sum + file.size, 0)

    for (const file of kept.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (totalBytes <= maxBytes)
        break

      await rm(file.path, { force: true })
      totalBytes -= file.size
      removedBytes += file.size
    }

    if (removedBytes > 0)
      logger.info('music.cache_cleaned', { bytes: removedBytes })
  }

  async function downloadFile(url: string, id: string): Promise<string> {
    await mkdir(dir, { recursive: true })
    await cleanOldFiles()

    const existing = finishedAudioFile(await filesIn(dir), id)

    if (existing !== undefined)
      return join(dir, existing)

    await extraction.download(url, join(dir, `${id}.%(ext)s`))

    const file = finishedAudioFile(await filesIn(dir), id)

    if (file === undefined)
      throw new Error('The extractor downloaded audio but no file was found.')

    return join(dir, file)
  }

  async function download(url: string, id: string): Promise<string> {
    const fileId = safeFileId(id)
    const pending = downloads.get(fileId)

    if (pending)
      return pending

    const task = downloadFile(url, fileId).finally(() => downloads.delete(fileId))

    downloads.set(fileId, task)

    return task
  }

  function prefetch(
    candidate: PrefetchCandidate | null | undefined,
    guildId: string,
    downloadAudio: (url: string, id: string) => Promise<unknown> = download,
  ): void {
    if (!candidate || disposed || prefetching.has(guildId))
      return

    const url = candidate.url

    if (url === undefined || url === null || url === '' || candidate.isLive === true || !isYoutubeUrl(url))
      return

    prefetching.add(guildId)

    void downloadAudio(url, candidate.id)
      .catch((error: unknown) => logger.error('music.prefetch_failed', error, { guildId }))
      .finally(() => prefetching.delete(guildId))
  }

  function dispose(): void {
    disposed = true
    prefetching.clear()
    downloads.clear()
  }

  return { fileFor, download, prefetch, dispose }
}
