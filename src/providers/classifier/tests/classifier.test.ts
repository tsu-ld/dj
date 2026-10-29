import type { AppConfig } from '../../../config.ts'
import type { Clock } from '../../../core/clock.ts'
import type { DecisionOption } from '../../../ports/decision.ts'
import { afterEach, describe, expect, test } from 'bun:test'
import { isRecord, parseJson } from '../../../core/json.ts'
import { logger } from '../../../core/logger.ts'
import { intentClassifier } from '../index.ts'

const realFetch = globalThis.fetch
const OPTIONS: readonly DecisionOption[] = [
  { name: 'pause', description: 'Pause the music.' },
  { name: 'skip', description: 'Skip the current song.' },
  { name: 'dj', description: 'Everything else.' },
]

const config: AppConfig['decision'] = {
  enabled: true,
  baseUrl: 'https://decision.example.com/v1/choose',
  apiKey: 'test-key',
  model: 'decision-model',
  timeoutMs: 5_000,
  minConfidence: 0.6,
  retryAfterMs: 60_000,
}

function fakeClock(start = 1_000_000): Clock & { advance: (milliseconds: number) => void } {
  let now = start

  return {
    now: () => now,
    sleep: async () => {},
    advance(milliseconds) {
      now += milliseconds
    },
  }
}

function stubFetch(answer: unknown): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = []

  globalThis.fetch = Object.assign(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = parseJson(String(init?.body ?? ''))

    if (isRecord(body))
      bodies.push(body)

    return Response.json({ answers: { action: answer } })
  }, { preconnect: realFetch.preconnect })

  return bodies
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('intentClassifier', () => {
  test('the decision sends the message, the state and the registered options', async () => {
    const bodies = stubFetch({ choice: 'pause', confidence: 0.9 })
    const classifier = intentClassifier({ config, logger: logger({ level: 'error', sink: () => {} }), clock: fakeClock() })

    const choice = await classifier.choose({
      text: 'pausá',
      state: { author_in_voice: true },
      options: OPTIONS,
      sessionId: 'chan-1',
    })

    expect(choice).toBe('pause')
    expect(bodies[0]?.model).toBe('decision-model')
    expect(bodies[0]?.state).toEqual({ message: 'pausá', author_in_voice: true })

    const questions = bodies[0]?.questions

    expect(isRecord(questions)).toBe(true)

    if (!isRecord(questions) || !isRecord(questions.action))
      throw new Error('expected a question')

    expect(questions.action.type).toBe('choice')
    expect(questions.action.instructions).toContain('Pick the single option that fits best.')
    expect(Object.keys(questions.action.criteria ?? {})).toEqual(['pause', 'skip', 'dj'])
  })

  test('the message overrides a message already in the state', async () => {
    const bodies = stubFetch({ choice: 'pause', confidence: 0.9 })
    const classifier = intentClassifier({ config, logger: logger({ level: 'error', sink: () => {} }), clock: fakeClock() })

    await classifier.choose({ text: 'pausá', state: { message: 'viejo' }, options: OPTIONS, sessionId: 'chan-1' })

    expect(bodies[0]?.state).toEqual({ message: 'pausá' })
  })

  test('a low-confidence decision falls back to the dj', async () => {
    stubFetch({ choice: 'pause', confidence: 0.4 })

    expect(await intentClassifier({ config, logger: logger({ level: 'error', sink: () => {} }), clock: fakeClock() }).choose({
      text: 'pausá',
      state: {},
      options: OPTIONS,
      sessionId: 'chan-1',
    })).toBeNull()
  })

  test('a confidence of exactly the minimum is accepted', async () => {
    stubFetch({ choice: 'pause', confidence: 0.6 })

    expect(await intentClassifier({ config, logger: logger({ level: 'error', sink: () => {} }), clock: fakeClock() }).choose({
      text: 'pausá',
      state: {},
      options: OPTIONS,
      sessionId: 'chan-1',
    })).toBe('pause')
  })

  test('a label outside the offered options falls back to the dj', async () => {
    stubFetch({ choice: 'set_persona', confidence: 0.9 })

    expect(await intentClassifier({ config, logger: logger({ level: 'error', sink: () => {} }), clock: fakeClock() }).choose({
      text: 'sé un dj',
      state: {},
      options: OPTIONS,
      sessionId: 'chan-1',
    })).toBeNull()
  })

  test('without an endpoint there is no decision call', async () => {
    let called = false

    globalThis.fetch = Object.assign(async () => {
      called = true

      return Response.json({})
    }, { preconnect: realFetch.preconnect })

    expect(await intentClassifier({
      config: { enabled: false },
      logger: logger({ level: 'error', sink: () => {} }),
      clock: fakeClock(),
    }).choose({ text: 'pausá', state: {}, options: OPTIONS, sessionId: 'chan-1' })).toBeNull()
    expect(called).toBe(false)
  })

  test('a failed decision rejects once, then the cooldown answers null', async () => {
    let calls = 0

    globalThis.fetch = Object.assign(async () => {
      calls++

      return Response.json({ error: 'slow down' }, { status: 429 })
    }, { preconnect: realFetch.preconnect })

    const classifier = intentClassifier({ config, logger: logger({ level: 'error', sink: () => {} }), clock: fakeClock() })

    await expect(classifier.choose({ text: 'pausá', state: {}, options: OPTIONS, sessionId: 'chan-1' }))
      .rejects
      .toThrow(/429/)
    expect(await classifier.choose({ text: 'pausá', state: {}, options: OPTIONS, sessionId: 'chan-1' })).toBeNull()
    expect(calls).toBe(1)
  })

  test('the cooldown expires after sixty seconds', async () => {
    const clock = fakeClock()
    let calls = 0

    globalThis.fetch = Object.assign(async () => {
      calls++

      if (calls === 1)
        return Response.json({ error: 'slow down' }, { status: 500 })

      return Response.json({ answers: { action: { choice: 'skip', confidence: 0.9 } } })
    }, { preconnect: realFetch.preconnect })

    const classifier = intentClassifier({ config, logger: logger({ level: 'error', sink: () => {} }), clock })

    await expect(classifier.choose({ text: 'skippea', state: {}, options: OPTIONS, sessionId: 'chan-1' }))
      .rejects
      .toThrow(/500/)

    clock.advance(59_999)
    expect(await classifier.choose({ text: 'skippea', state: {}, options: OPTIONS, sessionId: 'chan-1' })).toBeNull()

    clock.advance(1)
    expect(await classifier.choose({ text: 'skippea', state: {}, options: OPTIONS, sessionId: 'chan-1' })).toBe('skip')
    expect(calls).toBe(2)
  })
})
