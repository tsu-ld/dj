import type { Logger } from '../../core/logger.ts'
import type { Extractor } from './extraction.ts'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { errorMessage } from '../../core/errors.ts'
import { isRecord } from '../../core/json.ts'
import { isYoutubeUrl } from './policy.ts'

interface PrefetchCandidate {
  readonly id: string
  readonly url?: string | null
  readonly isLive?: boolean
}

export interface AudioCache {
  fileFor: (id: string) => Promise<string | null>
  download: (url: string, id: string) => Promise<string>
  prefetch: (candidate: PrefetchCandidate | null | undefined, guildId: string) => void
  dispose: () => void
}

function isUnfinishedDownload(file: string): boolean {
  return file.endsWith('.part') || file.endsWith('.ytdl')
}

function finishedAudioFile(files: ReadonlyArray<string>, id: string): string | undefined {
  return files.find((file) => file.startsWith(`${id}.`) && !isUnfinishedDownload(file))
}

function safeFileId(id: unknown): string {
  return String(id ?? '').replaceAll(/[^\w-]/g, '_')
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

  async function filesIn(dirPath: string): Promise<Array<string>> {
    return readdir(dirPath).catch((error: unknown) => {
      if (!isRecord(error) || error.code !== 'ENOENT') {
        logger.warn('music.cache_unreadable', { error: errorMessage(error) })
      }

      return []
    })
  }

  async function fileFor(id: string): Promise<string | null> {
    const file = finishedAudioFile(await filesIn(dir), safeFileId(id))

    return file === undefined ? null : join(dir, file)
  }

  async function cleanOldFiles(): Promise<void> {
    const now = Date.now()
    const kept: Array<{ path: string; size: number; mtimeMs: number }> = []
    let removedBytes = 0

    for (const file of await filesIn(dir)) {
      const path = join(dir, file)
      const info = await stat(path).catch(() => null)

      if (!info?.isFile()) {
        continue
      }

      if (now - info.mtimeMs > maxAgeMs) {
        await rm(path, { force: true })
        removedBytes += info.size
        continue
      }

      if (!isUnfinishedDownload(file)) {
        kept.push({ path, size: info.size, mtimeMs: info.mtimeMs })
      }
    }

    let totalBytes = kept.reduce((sum, file) => sum + file.size, 0)

    for (const file of kept.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (totalBytes <= maxBytes) {
        break
      }

      await rm(file.path, { force: true })
      totalBytes -= file.size
      removedBytes += file.size
    }

    if (removedBytes > 0) {
      logger.info('music.cache_cleaned', { bytes: removedBytes })
    }
  }

  async function downloadFile(url: string, id: string): Promise<string> {
    await mkdir(dir, { recursive: true })
    await cleanOldFiles()

    const existing = finishedAudioFile(await filesIn(dir), id)

    if (existing !== undefined) {
      return join(dir, existing)
    }

    await extraction.download(url, join(dir, `${id}.%(ext)s`))

    const file = finishedAudioFile(await filesIn(dir), id)

    if (file === undefined) {
      throw new Error('The extractor downloaded audio but no file was found.')
    }

    return join(dir, file)
  }

  async function download(url: string, id: string): Promise<string> {
    const fileId = safeFileId(id)
    const pending = downloads.get(fileId)

    if (pending) {
      return pending
    }

    const task = downloadFile(url, fileId).finally(() => downloads.delete(fileId))

    downloads.set(fileId, task)

    return task
  }

  function prefetch(candidate: PrefetchCandidate | null | undefined, guildId: string): void {
    if (!candidate || disposed || prefetching.has(guildId)) {
      return
    }

    const url = candidate.url

    if (
      url === undefined ||
      url === null ||
      url === '' ||
      candidate.isLive === true ||
      !isYoutubeUrl(url)
    ) {
      return
    }

    prefetching.add(guildId)

    void download(url, candidate.id)
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
