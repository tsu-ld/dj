import type { Logger } from '../../../core/logger.ts'
import type { AudioCache } from '../cache.ts'
import type { Extractor } from '../extraction.ts'
import { stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, test } from 'bun:test'
import { captureLog, silentLog as log, removeTempDirs, tempDir } from '../../../tests/fixtures.ts'
import { audioCache } from '../cache.ts'
import { extractionStub } from './fakes.ts'

afterEach(removeTempDirs)

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)

    return true
  } catch {
    return false
  }
}

function cacheIn(
  dir: string,
  logger: Logger = log,
  extraction: Extractor = extractionStub(),
): AudioCache {
  return audioCache({ dir, maxBytes: 1024 * 1024, maxAgeMs: 86_400_000, extraction, logger })
}

async function withFiles(
  files: ReadonlyArray<string>,
  check: (dir: string, cache: AudioCache) => Promise<void>,
): Promise<void> {
  const dir = await tempDir()

  for (const file of files) {
    await writeFile(join(dir, file), 'audio')
  }

  await check(dir, cacheIn(dir))
}

test('a partially downloaded song is not playable', async () => {
  await withFiles(['def456.m4a.part', 'abc123.webm', 'abc123.m4a.part'], async (dir, cache) => {
    expect(await cache.fileFor('abc123')).toBe(join(dir, 'abc123.webm'))
  })
})

test('files belonging to other songs are ignored', async () => {
  await withFiles(['def456.m4a', 'abc123.m4a.part', 'xyz789.webm'], async (_dir, cache) => {
    expect(await cache.fileFor('abc123')).toBeNull()
  })
})

test('partial and .ytdl downloads are never played', async () => {
  await withFiles(['abc123.webm.part'], async (_dir, cache) => {
    expect(await cache.fileFor('abc123')).toBeNull()
  })
  await withFiles(['abc123.webm.ytdl'], async (_dir, cache) => {
    expect(await cache.fileFor('abc123')).toBeNull()
  })
})

test('a file id is sanitized before it reaches a path', async () => {
  await withFiles(['abc123.m4a', '______etc_passwd.m4a'], async (dir, cache) => {
    expect(await cache.fileFor('abc123')).toBe(join(dir, 'abc123.m4a'))
    expect(await cache.fileFor('../../etc/passwd')).toBe(join(dir, '______etc_passwd.m4a'))
    expect(await cache.fileFor('../abc123')).toBeNull()
  })

  const dir = await tempDir()
  const templates: Array<string> = []

  const cache = cacheIn(
    dir,
    log,
    extractionStub({
      download: async (_url, template) => {
        templates.push(template)
        await writeFile(template.replace('%(ext)s', 'm4a'), 'audio')
      },
    }),
  )

  expect(await cache.download('https://www.youtube.com/watch?v=x', '../../etc/passwd')).toBe(
    join(dir, '______etc_passwd.m4a'),
  )
  expect(templates).toEqual([join(dir, '______etc_passwd.%(ext)s')])
})

test('a cache folder that does not exist yet means no song is on disk, quietly', async () => {
  const dir = await tempDir()
  const captured = captureLog()

  expect(await cacheIn(join(dir, 'not-created-yet'), captured.logger).fileFor('abc123')).toBeNull()
  expect(captured.events).toEqual([])
})

test('an unreadable cache folder is reported and the song is fetched instead', async () => {
  const dir = await tempDir()
  const captured = captureLog()
  const notAFolder = join(dir, 'a-file')

  await writeFile(notAFolder, 'not a folder')

  expect(await cacheIn(notAFolder, captured.logger).fileFor('abc123')).toBeNull()
  const warnings = captured.entries('music.cache_unreadable')

  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toMatchObject({ level: 'warn' })
  expect(JSON.stringify(warnings[0])).toContain('ENOTDIR')
})

test('a download writes one file and finds it by id', async () => {
  const dir = await tempDir()
  const tool = audioCache({
    dir,
    maxBytes: 1024 * 1024,
    maxAgeMs: 86_400_000,
    extraction: extractionStub({
      download: async (_url, template) => {
        await writeFile(template.replace('%(ext)s', 'm4a'), 'audio')
      },
    }),
    logger: log,
  })

  const path = await tool.download('https://www.youtube.com/watch?v=abc123', 'abc123')

  expect(path).toBe(join(dir, 'abc123.m4a'))
  expect(await tool.fileFor('abc123')).toBe(path)
  expect(await tool.fileFor('missing')).toBeNull()

  tool.dispose()
})

test('two simultaneous downloads of one song share the work', async () => {
  const dir = await tempDir()
  let calls = 0
  const tool = audioCache({
    dir,
    maxBytes: 1024 * 1024,
    maxAgeMs: 86_400_000,
    extraction: extractionStub({
      download: async (_url, template) => {
        calls++
        await Bun.sleep(10)
        await writeFile(template.replace('%(ext)s', 'm4a'), 'audio')
      },
    }),
    logger: log,
  })

  const [first, second] = await Promise.all([
    tool.download('https://www.youtube.com/watch?v=abc123', 'abc123'),
    tool.download('https://www.youtube.com/watch?v=abc123', 'abc123'),
  ])

  expect(first).toBe(second)
  expect(calls).toBe(1)

  tool.dispose()
})

test('cache cleanup drops old files and trims by size, never counting partials', async () => {
  const dir = await tempDir()
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000)
  const old = join(dir, 'old.m4a')
  const oldPartial = join(dir, 'stale.m4a.part')
  const kept = join(dir, 'keep.m4a')
  const partial = join(dir, 'pending.m4a.part')

  await writeFile(old, 'x')
  await writeFile(oldPartial, 'x')
  await writeFile(kept, 'x'.repeat(20))
  await writeFile(partial, 'x'.repeat(20))
  await utimes(old, twoDaysAgo, twoDaysAgo)
  await utimes(oldPartial, twoDaysAgo, twoDaysAgo)

  const tool = audioCache({
    dir,
    maxBytes: 10,
    maxAgeMs: 86_400_000,
    extraction: extractionStub({
      download: async (_url, template) => {
        await writeFile(template.replace('%(ext)s', 'm4a'), 'new')
      },
    }),
    logger: log,
  })

  await tool.download('https://www.youtube.com/watch?v=new', 'new')

  expect(await exists(old)).toBe(false)
  expect(await exists(oldPartial)).toBe(false)
  expect(await exists(kept)).toBe(false)
  expect(await exists(partial)).toBe(true)
  expect(await exists(join(dir, 'new.m4a'))).toBe(true)

  tool.dispose()
})

test('the next song is prefetched once per server, and only when the extractor can play it', async () => {
  const dir = await tempDir()
  const downloads: Array<string> = []
  const pending = Promise.withResolvers<void>()
  let started = Promise.withResolvers<void>()
  const extraction = extractionStub({
    async download(_url, template) {
      downloads.push(template.slice(dir.length + 1).split('.')[0] ?? '')
      started.resolve()
      await pending.promise
      await writeFile(template.replace('%(ext)s', 'm4a'), 'audio')
    },
  })

  const tool = audioCache({
    dir,
    maxBytes: 1024 * 1024,
    maxAgeMs: 86_400_000,
    extraction,
    logger: log,
  })

  tool.prefetch({ url: 'https://www.youtube.com/watch?v=a', id: 'a' }, 'g1')
  tool.prefetch({ url: 'https://www.youtube.com/watch?v=b', id: 'b' }, 'g1')
  tool.prefetch({ url: 'https://open.spotify.com/track/x', id: 'x' }, 'g2')
  tool.prefetch({ url: 'https://www.youtube.com/watch?v=c', id: 'c', isLive: true }, 'g2')
  await started.promise

  expect(downloads).toEqual(['a'])

  pending.resolve()
  await tool.download('https://www.youtube.com/watch?v=a', 'a')
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })

  started = Promise.withResolvers<void>()
  tool.prefetch({ url: 'https://www.youtube.com/watch?v=d', id: 'd' }, 'g1')
  await started.promise

  expect(downloads).toEqual(['a', 'd'])

  await tool.download('https://www.youtube.com/watch?v=d', 'd')
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })

  tool.dispose()
})
