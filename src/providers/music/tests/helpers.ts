import type { GuildMember } from 'discord.js'
import type { Logger } from '../../../core/logger.ts'
import type { Track } from '../../../ports/music.ts'
import type { Extractor } from '../extraction.ts'
import type { StreamResolver } from '../stream.ts'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { errorMessage } from '../../../core/errors.ts'
import { logger } from '../../../core/logger.ts'

export const log: Logger = logger({ level: 'error', sink: () => {} })

// Bun types the rejection matcher as a plain assertion, but a test that does not
// await it can pass before the promise settles. This keeps the await real.
export async function rejection(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  }
  catch (error) {
    return errorMessage(error)
  }

  throw new Error('Expected the operation to reject.')
}

export function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 'song-1',
    title: 'Song 1',
    url: 'https://www.youtube.com/watch?v=song-1',
    durationSeconds: 180,
    isLive: false,
    thumbnail: null,
    requestedBy: null,
    requesterId: null,
    artist: null,
    fromRadio: false,
    ...overrides,
  }
}

// the SDK only keeps a member whose ids look like snowflakes
export function memberOf(id: string, displayName: string): GuildMember {
  return { id, displayName, user: { id }, guild: { id: '100000000000000001' } } as unknown as GuildMember
}

export async function tempDir(): Promise<{ dir: string, cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'dj-music-'))

  return { dir, cleanup: async () => rm(dir, { recursive: true, force: true }) }
}

export async function shellScript(dir: string, name: string, body: string): Promise<string> {
  const file = join(dir, name)

  await writeFile(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })

  return file
}

export function extractionStub(overrides: Partial<Extractor> = {}): Extractor {
  return {
    json: async () => ({}),
    streamUrl: async () => null,
    download: async () => {},
    dispose: async () => {},
    ...overrides,
  }
}

export function streamStub(overrides: Partial<StreamResolver> = {}): StreamResolver {
  return {
    remember: () => {},
    forget: () => {},
    playableUrl: async () => 'https://cdn.test/audio',
    dispose: () => {},
    ...overrides,
  }
}
