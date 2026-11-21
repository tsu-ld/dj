import type { AppConfig } from '../../../config.ts'
import type { Clock } from '../../../core/clock.ts'
import type { Logger } from '../../../core/logger.ts'
import type { SpeechPort } from '../../../ports/speech.ts'
import type { FetchCalls } from '../../tests/http.ts'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { captureLog, removeTempDirs, tempDir, testClock } from '../../../tests/fixtures.ts'
import { json, restoreFetch, stubFetch } from '../../tests/http.ts'
import { speechSynthesizer } from '../index.ts'

type SpeechConfig = AppConfig['speech']
type EnabledSpeech = Extract<SpeechConfig, { enabled: true }>

let directory = ''
let previousTmp: string | undefined

beforeEach(async () => {
  directory = await tempDir()
  previousTmp = process.env.TMPDIR
  process.env.TMPDIR = directory
})

afterEach(async () => {
  restoreFetch()

  if (previousTmp === undefined)
    delete process.env.TMPDIR
  else
    process.env.TMPDIR = previousTmp

  await removeTempDirs()
})

function config(overrides: Partial<EnabledSpeech> = {}): SpeechConfig {
  return {
    enabled: true,
    apiKey: 'secret',
    voiceId: 'voice-1',
    model: 'eleven_v4',
    timeoutMs: 12_000,
    maxChars: 300,
    quotaCacheMs: 300_000,
    ...overrides,
  }
}

function usageBody(used: number, limit: number): Response {
  return json({ character_count: used, character_limit: limit })
}

function audioBody(): Response {
  return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
}

function providerFetch(options: {
  usage?: () => Response
  audio?: () => Response
} = {}): FetchCalls {
  return stubFetch(async (input) => {
    if (String(input).includes('/user/subscription'))
      return options.usage?.() ?? usageBody(0, 100_000)

    return options.audio?.() ?? audioBody()
  })
}

function synthesizer(deps: { logger?: Logger, clock?: Clock } = {}): SpeechPort {
  return speechSynthesizer({ config: config(), logger: deps.logger ?? captureLog().logger, clock: deps.clock ?? testClock() })
}

async function lineAgainstQuota(used: number, length: number): Promise<{ aired: boolean, synthesized: number }> {
  restoreFetch()

  const fetch = providerFetch({ usage: () => usageBody(used, 10_000) })
  const file = await synthesizer().synthesize('x'.repeat(length))

  return { aired: file !== null, synthesized: fetch.matching('/text-to-speech') }
}

describe('the monthly quota', () => {
  test('a line only fits while the monthly quota covers it', async () => {
    expect(await lineAgainstQuota(0, 110)).toEqual({ aired: true, synthesized: 1 })
    expect(await lineAgainstQuota(9_950, 110)).toEqual({ aired: false, synthesized: 0 })
    expect(await lineAgainstQuota(9_950, 50)).toEqual({ aired: true, synthesized: 1 })
  })
})

describe('configuration', () => {
  test('without a voice configured nothing is synthesized', async () => {
    const speech = speechSynthesizer({
      config: { enabled: false },
      logger: captureLog().logger,
      clock: testClock(),
    })

    expect(speech.available).toBe(false)
    expect(await speech.synthesize('Hola')).toBeNull()
  })

  test('a line over the hard cap is dropped before it costs credits', async () => {
    const fetch = providerFetch()

    const speech = synthesizer()

    expect(await speech.synthesize('x'.repeat(301))).toBeNull()
    expect(fetch.count()).toBe(0)
  })
})

describe('rendering', () => {
  test('a successful line is written under the audio directory with a unique name', async () => {
    providerFetch({ audio: () => audioBody() })

    const speech = synthesizer()
    const file = await speech.synthesize('Hola')

    if (file === null)
      throw new Error('Expected a clip')

    expect(dirname(file)).toBe(join(directory, 'dj-speech'))
    expect(basename(file)).toMatch(/^tts-1000000-[a-z0-9]+\.mp3$/)
    expect([...await readFile(file)]).toEqual([1, 2, 3])
    expect(existsSync(file)).toBe(true)

    await speech.dispose()

    expect(existsSync(file)).toBe(false)
  })

  test('dispose deletes every file the provider created', async () => {
    providerFetch()

    const speech = synthesizer()
    const first = await speech.synthesize('Uno')
    const second = await speech.synthesize('Dos')

    if (first === null || second === null)
      throw new Error('Expected two clips')

    await speech.dispose()

    expect(existsSync(first)).toBe(false)
    expect(existsSync(second)).toBe(false)
    expect(await speech.synthesize('Tres')).toBeNull()
  })
})

describe('cleanup', () => {
  test('a clip dispose cannot delete is logged as a warning', async () => {
    providerFetch()

    const capture = captureLog()
    const speech = synthesizer({ logger: capture.logger })
    const file = await speech.synthesize('Hola')

    if (file === null)
      throw new Error('Expected a clip')

    await rm(file)
    await mkdir(file)
    await writeFile(join(file, 'blocker'), '')
    await speech.dispose()

    expect(capture.entries('speech.clip_delete_failed')).toEqual([expect.objectContaining({ level: 'warn', path: file })])
  })
})

describe('quota', () => {
  test('the usage cache lives for five minutes', async () => {
    const fetch = providerFetch()
    const clock = testClock()

    const speech = synthesizer({ clock })

    await speech.synthesize('abc')
    await speech.synthesize('abc')

    expect(fetch.matching('/user/subscription')).toBe(1)

    clock.advance(300_000)

    await speech.synthesize('abc')

    expect(fetch.matching('/user/subscription')).toBe(2)
  })

  test('a successful line adds its length to the cached usage', async () => {
    const fetch = providerFetch({ usage: () => usageBody(100, 105) })

    const speech = synthesizer()

    expect(await speech.synthesize('abc')).not.toBeNull()
    expect(await speech.synthesize('abc')).toBeNull()
    expect(fetch.matching('/text-to-speech')).toBe(1)
    expect(fetch.matching('/user/subscription')).toBe(1)
  })

  test('a failed usage read is logged and lets the line through', async () => {
    const capture = captureLog()

    stubFetch(async (input) => {
      if (String(input).includes('/user/subscription'))
        return new Response('nope', { status: 500 })

      return audioBody()
    })

    const speech = synthesizer({ logger: capture.logger })

    expect(await speech.synthesize('Hola')).not.toBeNull()
    expect(capture.events).toContain('speech.quota_unreadable')
  })

  test('a confirmed shortage skips the line before synthesizing', async () => {
    const fetch = providerFetch({ usage: () => usageBody(100, 100) })
    const capture = captureLog()

    const speech = synthesizer({ logger: capture.logger })

    expect(await speech.synthesize('Hola')).toBeNull()
    expect(fetch.matching('/text-to-speech')).toBe(0)
    expect(capture.events).toContain('speech.quota_exhausted')
  })

  test('a quota rejection marks the cache full without latching the provider', async () => {
    let usageReads = 0
    let audioCalls = 0

    const fetch = stubFetch(async (input) => {
      if (String(input).includes('/user/subscription')) {
        usageReads++

        return usageReads === 1 ? usageBody(100, 1000) : usageBody(0, 1000)
      }

      audioCalls++

      if (audioCalls === 1)
        return new Response('{"detail":{"code":"quota_exceeded","status":"max_character_limit_exceeded"}}', { status: 401 })

      return audioBody()
    })
    const clock = testClock()

    const speech = synthesizer({ clock })

    expect(await speech.synthesize('Hola')).toBeNull()
    expect(speech.available).toBe(true)
    expect(await speech.synthesize('Hola')).toBeNull()
    expect(fetch.matching('/user/subscription')).toBe(1)
    expect(fetch.matching('/text-to-speech')).toBe(1)

    clock.advance(300_000)

    expect(await speech.synthesize('Hola')).not.toBeNull()
    expect(speech.available).toBe(true)
  })
})

describe('credentials', () => {
  test('a rejected key latches the provider until restart', async () => {
    const fetch = providerFetch({
      audio: () => new Response('{"detail":{"code":"unauthorized","status":"invalid_api_key"}}', { status: 401 }),
    })
    const capture = captureLog()

    const speech = synthesizer({ logger: capture.logger })

    expect(await speech.synthesize('Hola')).toBeNull()
    expect(speech.available).toBe(false)
    expect(await speech.synthesize('Hola')).toBeNull()
    expect(fetch.matching('/text-to-speech')).toBe(1)
    expect(capture.events).toContain('speech.credentials_rejected')
  })

  test('a forbidden key also latches', async () => {
    const fetch = providerFetch({ audio: () => new Response('nope', { status: 403 }) })

    const speech = synthesizer()

    expect(await speech.synthesize('Hola')).toBeNull()
    expect(speech.available).toBe(false)
    expect(await speech.synthesize('Hola')).toBeNull()
    expect(fetch.matching('/text-to-speech')).toBe(1)
  })
})

describe('failures', () => {
  test('a network failure returns null instead of throwing', async () => {
    stubFetch(async () => {
      throw new Error('offline')
    })

    const capture = captureLog()
    const speech = synthesizer({ logger: capture.logger })

    expect(await speech.synthesize('Hola')).toBeNull()
    expect(speech.available).toBe(true)
    expect(capture.events).toContain('speech.synthesis_failed')
  })

  test('an invalid subscription shape is a failed read, not an empty quota', async () => {
    stubFetch(async (input) => {
      if (String(input).includes('/user/subscription'))
        return json({ character_count: null, character_limit: 10000 })

      return audioBody()
    })

    const capture = captureLog()
    const speech = synthesizer({ logger: capture.logger })

    expect(await speech.synthesize('Hola')).not.toBeNull()
    expect(capture.events).toContain('speech.quota_unreadable')
  })
})
