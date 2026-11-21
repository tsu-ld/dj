import type { GuildMember } from 'discord.js'
import type { Song } from 'distube'
import type { Extractor } from '../extraction.ts'
import type { StreamResolver } from '../stream.ts'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from 'bun:test'
import { Playlist } from 'distube'
import { errorMessage } from '../../../core/errors.ts'

// WORKAROUND(https://github.com/oven-sh/bun/issues/47556): bun-types 1.4.5 types the rejects matchers as returning void, so an un-awaited one can pass before the promise settles; rejection keeps the await real. Goes when a release types them as promises.
export async function rejection<Result>(run: () => Promise<Result>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return errorMessage(error)
  }

  throw new Error('Expected the operation to reject.')
}

const SNOWFLAKE_GUILD_ID = '100000000000000001'

export function expectPlaylist<Metadata>(
  resolved: Song<Metadata> | Playlist<Metadata>,
): Playlist<Metadata> {
  expect(resolved).toBeInstanceOf(Playlist)

  if (!('songs' in resolved)) {
    throw new Error('expected a playlist')
  }

  return resolved
}

export function memberOf(snowflakeId: string, displayName: string): GuildMember {
  return {
    id: snowflakeId,
    displayName,
    user: { id: snowflakeId },
    guild: { id: SNOWFLAKE_GUILD_ID },
  } as unknown as GuildMember
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
