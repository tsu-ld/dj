import type { GuildMember } from 'discord.js'
import type { Extractor } from '../extraction.ts'
import type { StreamResolver } from '../stream.ts'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { errorMessage } from '../../../core/errors.ts'

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

// the SDK only keeps a member whose ids look like snowflakes
export function memberOf(id: string, displayName: string): GuildMember {
  return { id, displayName, user: { id }, guild: { id: '100000000000000001' } } as unknown as GuildMember
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
