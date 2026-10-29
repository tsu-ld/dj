import { stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { audioCache, finishedAudioFile, safeFileId } from '../cache.ts'
import { extractionStub, log, tempDir } from './helpers.ts'

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)

    return true
  }
  catch {
    return false
  }
}

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

test('a download writes one file and finds it by id', async () => {
  const { dir, cleanup } = await tempDir()

  try {
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
  }
  finally {
    await cleanup()
  }
})

test('two simultaneous downloads of one song share the work', async () => {
  const { dir, cleanup } = await tempDir()

  try {
    let calls = 0
    const tool = audioCache({
      dir,
      maxBytes: 1024 * 1024,
      maxAgeMs: 86_400_000,
      extraction: extractionStub({
        download: async (_url, template) => {
          calls++
          await new Promise(resolve => setTimeout(resolve, 10))
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
  }
  finally {
    await cleanup()
  }
})

test('cache cleanup drops old files and trims by size, never counting partials', async () => {
  const { dir, cleanup } = await tempDir()

  try {
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
  }
  finally {
    await cleanup()
  }
})

test('the next song is prefetched once per server, and only when the extractor can play it', async () => {
  const { dir, cleanup } = await tempDir()

  try {
    const downloads: string[] = []
    let release = (): void => {}

    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const download = async (_url: string, id: string): Promise<void> => {
      downloads.push(id)

      return pending
    }

    const tool = audioCache({
      dir,
      maxBytes: 1024 * 1024,
      maxAgeMs: 86_400_000,
      extraction: extractionStub(),
      logger: log,
    })

    tool.prefetch({ url: 'https://www.youtube.com/watch?v=a', id: 'a' }, 'g1', download)
    tool.prefetch({ url: 'https://www.youtube.com/watch?v=b', id: 'b' }, 'g1', download)
    tool.prefetch({ url: 'https://open.spotify.com/track/x', id: 'x' }, 'g2', download)
    tool.prefetch({ url: 'https://www.youtube.com/watch?v=c', id: 'c', isLive: true }, 'g2', download)

    expect(downloads).toEqual(['a'])

    release()
    await pending
    await new Promise(resolve => setImmediate(resolve))

    tool.prefetch({ url: 'https://www.youtube.com/watch?v=d', id: 'd' }, 'g1', download)

    expect(downloads).toEqual(['a', 'd'])

    await new Promise(resolve => setImmediate(resolve))

    tool.dispose()
  }
  finally {
    await cleanup()
  }
})
