import type { AppConfig } from '../../../config.ts'
import type { Clock } from '../../../core/clock.ts'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { loadConfig } from '../../../config.ts'
import { logger } from '../../../core/logger.ts'
import { fitsQuota, speechSynthesizer } from '../index.ts'

type SpeechConfig = AppConfig['speech']
type EnabledSpeech = Extract<SpeechConfig, { enabled: true }>

interface TestClock extends Clock {
  advance: (milliseconds: number) => void
}

type FetchHandler = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface FetchCalls {
  count: () => number
  matching: (path: string) => number
}

// Bun's fetch carries a static helper, so the stub has to carry it too.
function fetchStub(handler: FetchHandler): typeof fetch {
  return Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => handler(input, init),
    { preconnect: globalThis.fetch.preconnect },
  )
}

let directory = ''
let previousTmp: string | undefined
const restores: (() => void)[] = []

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dj-speech-'))
  previousTmp = process.env.TMPDIR
  process.env.TMPDIR = directory
})

afterEach(async () => {
  while (restores.length > 0)
    restores.pop()?.()

  if (previousTmp === undefined)
    delete process.env.TMPDIR
  else
    process.env.TMPDIR = previousTmp

  await rm(directory, { recursive: true, force: true })
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

function clockAt(start = 1_700_000_000_000): TestClock {
  let now = start

  return {
    now: () => now,
    sleep: async () => {},
    advance: (milliseconds) => {
      now += milliseconds
    },
  }
}

function captureLogger(): { lines: string[], port: ReturnType<typeof logger> } {
  const lines: string[] = []

  return { lines, port: logger({ level: 'debug', sink: line => lines.push(line) }) }
}

function stubFetch(handler: FetchHandler): FetchCalls {
  const spy = spyOn(globalThis, 'fetch').mockImplementation(fetchStub(handler))

  restores.push(() => spy.mockRestore())

  return {
    count: () => spy.mock.calls.length,
    matching: path => spy.mock.calls.filter(([input]) => String(input).includes(path)).length,
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function usageBody(used: number, limit: number): Response {
  return json({ character_count: used, character_limit: limit })
}

function audioBody(bytes: readonly number[] = [1, 2, 3]): Response {
  return new Response(new Uint8Array(bytes), { status: 200 })
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

describe('fitsQuota', () => {
  test('a line only fits while the monthly quota covers it', () => {
    expect(fitsQuota({ used: 0, limit: 10_000 }, 110)).toBe(true)
    expect(fitsQuota({ used: 9_950, limit: 10_000 }, 110)).toBe(false)
    expect(fitsQuota({ used: 9_950, limit: 10_000 }, 50)).toBe(true)
  })
})

describe('configuration', () => {
  test('without a voice configured nothing is synthesized', async () => {
    const speech = speechSynthesizer({
      config: { enabled: false },
      logger: captureLogger().port,
      clock: clockAt(),
    })

    expect(speech.available).toBe(false)
    expect(await speech.synthesize('Hola')).toBeNull()
    expect(await speech.dispose()).toBeUndefined()
  })

  test('without a voice id the key alone is not enough', () => {
    const loaded = loadConfig({ DISCORD_TOKEN: 'token', SPEECH_API_KEY: 'key' })

    expect(loaded.speech.enabled).toBe(false)
  })

  test('a line over the hard cap is dropped before it costs credits', async () => {
    const fetch = providerFetch()

    const speech = speechSynthesizer({
      config: config(),
      logger: captureLogger().port,
      clock: clockAt(),
    })

    expect(await speech.synthesize('x'.repeat(301))).toBeNull()
    expect(fetch.count()).toBe(0)
  })
})

describe('rendering', () => {
  test('a successful line is written under the audio directory with a unique name', async () => {
    providerFetch({ audio: () => audioBody([1, 2, 3]) })

    const speech = speechSynthesizer({
      config: config(),
      logger: captureLogger().port,
      clock: clockAt(),
    })
    const file = await speech.synthesize('Hola')

    if (file === null)
      throw new Error('Expected a clip')

    expect(dirname(file)).toBe(join(directory, 'dj-audio'))
    expect(basename(file)).toMatch(/^tts-1700000000000-[a-z0-9]+\.mp3$/)
    expect([...await readFile(file)]).toEqual([1, 2, 3])
    expect(existsSync(file)).toBe(true)

    await speech.dispose()

    expect(existsSync(file)).toBe(false)
  })

  test('dispose deletes every file the provider created', async () => {
    providerFetch()

    const speech = speechSynthesizer({
      config: config(),
      logger: captureLogger().port,
      clock: clockAt(),
    })
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

describe('quota', () => {
  test('the usage cache lives for five minutes', async () => {
    const fetch = providerFetch()
    const clock = clockAt()

    const speech = speechSynthesizer({ config: config(), logger: captureLogger().port, clock })

    await speech.synthesize('abc')
    await speech.synthesize('abc')

    expect(fetch.matching('/user/subscription')).toBe(1)

    clock.advance(300_000)

    await speech.synthesize('abc')

    expect(fetch.matching('/user/subscription')).toBe(2)
  })

  test('a successful line adds its length to the cached usage', async () => {
    const fetch = providerFetch({ usage: () => usageBody(100, 105) })

    const speech = speechSynthesizer({
      config: config(),
      logger: captureLogger().port,
      clock: clockAt(),
    })

    expect(await speech.synthesize('abc')).not.toBeNull()
    expect(await speech.synthesize('abc')).toBeNull()
    expect(fetch.matching('/text-to-speech')).toBe(1)
    expect(fetch.matching('/user/subscription')).toBe(1)
  })

  test('a failed usage read is logged and lets the line through', async () => {
    const capture = captureLogger()

    stubFetch(async (input) => {
      if (String(input).includes('/user/subscription'))
        return new Response('nope', { status: 500 })

      return audioBody()
    })

    const speech = speechSynthesizer({ config: config(), logger: capture.port, clock: clockAt() })

    expect(await speech.synthesize('Hola')).not.toBeNull()
    expect(capture.lines.some(line => line.includes('speech.quota_unreadable'))).toBe(true)
  })

  test('a confirmed shortage skips the line before synthesizing', async () => {
    const fetch = providerFetch({ usage: () => usageBody(100, 100) })
    const capture = captureLogger()

    const speech = speechSynthesizer({ config: config(), logger: capture.port, clock: clockAt() })

    expect(await speech.synthesize('Hola')).toBeNull()
    expect(fetch.matching('/text-to-speech')).toBe(0)
    expect(capture.lines.some(line => line.includes('speech.quota_exhausted'))).toBe(true)
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
    const clock = clockAt()

    const speech = speechSynthesizer({ config: config(), logger: captureLogger().port, clock })

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
    const capture = captureLogger()

    const speech = speechSynthesizer({ config: config(), logger: capture.port, clock: clockAt() })

    expect(await speech.synthesize('Hola')).toBeNull()
    expect(speech.available).toBe(false)
    expect(await speech.synthesize('Hola')).toBeNull()
    expect(fetch.matching('/text-to-speech')).toBe(1)
    expect(capture.lines.some(line => line.includes('speech.credentials_rejected'))).toBe(true)
  })

  test('a forbidden key also latches', async () => {
    const fetch = providerFetch({ audio: () => new Response('nope', { status: 403 }) })

    const speech = speechSynthesizer({
      config: config(),
      logger: captureLogger().port,
      clock: clockAt(),
    })

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

    const capture = captureLogger()
    const speech = speechSynthesizer({ config: config(), logger: capture.port, clock: clockAt() })

    expect(await speech.synthesize('Hola')).toBeNull()
    expect(speech.available).toBe(true)
    expect(capture.lines.some(line => line.includes('speech.synthesis_failed'))).toBe(true)
  })

  test('an invalid subscription shape is a failed read, not an empty quota', async () => {
    stubFetch(async (input) => {
      if (String(input).includes('/user/subscription'))
        return json({ character_count: null, character_limit: 10000 })

      return audioBody()
    })

    const capture = captureLogger()
    const speech = speechSynthesizer({ config: config(), logger: capture.port, clock: clockAt() })

    expect(await speech.synthesize('Hola')).not.toBeNull()
    expect(capture.lines.some(line => line.includes('speech.quota_unreadable'))).toBe(true)
  })
})
