import type { AppConfig } from '../../../config.ts'
import type { DecisionOption } from '../../../ports/decision.ts'
import type { FetchCalls } from '../../tests/http.ts'
import { afterEach, describe, expect, test } from 'bun:test'
import { isRecord, parseJson } from '../../../core/json.ts'
import { testClock } from '../../../tests/fixtures.ts'
import { restoreFetch, stubFetch } from '../../tests/http.ts'
import { intentClassifier } from '../index.ts'

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

function answer(choice: unknown): FetchCalls {
  return stubFetch(async () => Response.json({ answers: { action: choice } }))
}

function sentBody(calls: FetchCalls, index: number): Record<string, unknown> {
  const body = parseJson(String(calls.at(index).init?.body ?? ''))

  if (!isRecord(body))
    throw new Error(`request ${index} sent no JSON body`)

  return body
}

afterEach(restoreFetch)

describe('intentClassifier', () => {
  test('the decision sends the message, the state and the registered options', async () => {
    const calls = answer({ choice: 'pause', confidence: 0.9 })
    const classifier = intentClassifier({ config, clock: testClock() })

    const choice = await classifier.choose({
      text: 'pausá',
      state: { author_in_voice: true },
      options: OPTIONS,
      sessionId: 'chan-1',
    })

    expect(choice).toBe('pause')
    expect(sentBody(calls, 0).model).toBe('decision-model')
    expect(sentBody(calls, 0).state).toEqual({ message: 'pausá', author_in_voice: true })

    const questions = sentBody(calls, 0).questions

    expect(isRecord(questions)).toBe(true)

    if (!isRecord(questions) || !isRecord(questions.action))
      throw new Error('expected a question')

    expect(questions.action.type).toBe('choice')
    expect(questions.action.instructions).toContain('Pick the single option that fits best.')
    expect(Object.keys(questions.action.criteria ?? {})).toEqual(['pause', 'skip', 'dj'])
  })

  test('the message overrides a message already in the state', async () => {
    const calls = answer({ choice: 'pause', confidence: 0.9 })
    const classifier = intentClassifier({ config, clock: testClock() })

    await classifier.choose({ text: 'pausá', state: { message: 'viejo' }, options: OPTIONS, sessionId: 'chan-1' })

    expect(sentBody(calls, 0).state).toEqual({ message: 'pausá' })
  })

  test('a low-confidence decision falls back to the dj', async () => {
    answer({ choice: 'pause', confidence: 0.4 })

    expect(await intentClassifier({ config, clock: testClock() }).choose({
      text: 'pausá',
      state: {},
      options: OPTIONS,
      sessionId: 'chan-1',
    })).toBeNull()
  })

  test('a confidence of exactly the minimum is accepted', async () => {
    answer({ choice: 'pause', confidence: 0.6 })

    expect(await intentClassifier({ config, clock: testClock() }).choose({
      text: 'pausá',
      state: {},
      options: OPTIONS,
      sessionId: 'chan-1',
    })).toBe('pause')
  })

  test('a label outside the offered options falls back to the dj', async () => {
    answer({ choice: 'set_persona', confidence: 0.9 })

    expect(await intentClassifier({ config, clock: testClock() }).choose({
      text: 'sé un dj',
      state: {},
      options: OPTIONS,
      sessionId: 'chan-1',
    })).toBeNull()
  })

  test('without an endpoint there is no decision call', async () => {
    let called = false

    stubFetch(async () => {
      called = true

      return Response.json({})
    })

    expect(await intentClassifier({
      config: { enabled: false },
      clock: testClock(),
    }).choose({ text: 'pausá', state: {}, options: OPTIONS, sessionId: 'chan-1' })).toBeNull()
    expect(called).toBe(false)
  })

  test('a failed decision rejects once, then the cooldown answers null', async () => {
    let calls = 0

    stubFetch(async () => {
      calls++

      return Response.json({ error: 'slow down' }, { status: 429 })
    })

    const classifier = intentClassifier({ config, clock: testClock() })

    await expect(classifier.choose({ text: 'pausá', state: {}, options: OPTIONS, sessionId: 'chan-1' }))
      .rejects
      .toThrow(/429/)
    expect(await classifier.choose({ text: 'pausá', state: {}, options: OPTIONS, sessionId: 'chan-1' })).toBeNull()
    expect(calls).toBe(1)
  })

  test('the cooldown expires after sixty seconds', async () => {
    const clock = testClock()
    let calls = 0

    stubFetch(async () => {
      calls++

      if (calls === 1)
        return Response.json({ error: 'slow down' }, { status: 500 })

      return Response.json({ answers: { action: { choice: 'skip', confidence: 0.9 } } })
    })

    const classifier = intentClassifier({ config, clock })

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
