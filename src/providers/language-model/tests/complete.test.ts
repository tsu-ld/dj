import type { AppConfig } from '../../../config.ts'
import type { CompletionRequest } from '../../../ports/conversation.ts'
import type { FetchCalls } from '../../tests/http.ts'
import { afterEach, describe, expect, test } from 'bun:test'
import { ProviderError } from '../../../core/errors.ts'
import { isRecord, parseJson } from '../../../core/json.ts'
import { silentLog as log } from '../../../tests/fixtures.ts'
import { restoreFetch, stubFetch } from '../../tests/http.ts'
import { conversationModel } from '../index.ts'

const config: AppConfig['language'] = {
  enabled: true,
  baseUrl: 'https://llm.example.com/v1/complete',
  apiKey: 'test-key',
  model: 'test-model',
  timeoutMs: 40_000,
  maxOutputTokens: 800,
}

function request(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    instructions: '',
    messages: [],
    timeoutMs: 1_000,
    sessionId: 'chan-1',
    ...overrides,
  }
}

function sentBody(calls: FetchCalls, index: number): Record<string, unknown> {
  const body = parseJson(String(calls.at(index).init?.body ?? ''))

  if (!isRecord(body))
    throw new Error(`request ${index} sent no JSON body`)

  return body
}

function textPayload(text: string): Response {
  return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] })
}

afterEach(restoreFetch)

describe('conversationModel', () => {
  test('a request with tools asks the endpoint to pick them', async () => {
    const calls = stubFetch(async () => textPayload('va'))

    await conversationModel({ config, logger: log }).complete(request({
      tools: [{ name: 'skip_song', description: 'Skip the song.', parameters: {} }],
    }))

    expect(sentBody(calls, 0).tools).toEqual([
      { type: 'function', name: 'skip_song', description: 'Skip the song.', parameters: {} },
    ])
    expect(sentBody(calls, 0).tool_choice).toBe('auto')
  })

  test('a request without tools sends neither key', async () => {
    const calls = stubFetch(async () => textPayload('va'))

    await conversationModel({ config, logger: log }).complete(request())

    expect(calls.count()).toBe(1)
    expect(sentBody(calls, 0).tools).toBeUndefined()
    expect(sentBody(calls, 0).tool_choice).toBeUndefined()
    expect(sentBody(calls, 0).reasoning).toBeUndefined()
  })

  test('a request can turn reasoning off for a fast answer', async () => {
    const calls = stubFetch(async () => textPayload('va'))

    await conversationModel({ config, logger: log }).complete(request({ reasoning: 'none' }))

    expect(sentBody(calls, 0).reasoning).toEqual({ effort: 'none' })
  })

  test('instructions and chat messages become the endpoint shape', async () => {
    const calls = stubFetch(async () => textPayload('va'))

    await conversationModel({ config, logger: log }).complete(request({
      instructions: 'sos un dj',
      messages: [{ role: 'user', content: 'que suena?' }],
    }))

    expect(sentBody(calls, 0).instructions).toBe('sos un dj')
    expect(sentBody(calls, 0).input).toEqual([{ role: 'user', content: 'que suena?' }])
  })

  test('tool calls round-trip between the chat shape and the endpoint shape', async () => {
    const calls = stubFetch(async () => Response.json({
      output: [{ type: 'function_call', call_id: 'call_1', name: 'skip_song', arguments: '{}' }],
    }))
    const model = conversationModel({ config, logger: log })
    const reply = await model.complete(request())

    expect(reply.toolCalls).toEqual([{ id: 'call_1', name: 'skip_song', arguments: '{}' }])
    expect(reply.text).toBeNull()

    await model.complete(request({
      messages: [
        { role: 'assistant', content: null, toolCalls: reply.toolCalls },
        { role: 'tool', toolCallId: 'call_1', content: '{"ok":true}' },
      ],
    }))

    expect(sentBody(calls, 1).input).toEqual([
      { type: 'function_call', call_id: 'call_1', name: 'skip_song', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
    ])
  })

  test('output text is concatenated', async () => {
    stubFetch(async () => Response.json({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'uno' }] },
        { type: 'message', content: [{ type: 'output_text', text: ' dos' }] },
      ],
    }))

    const reply = await conversationModel({ config, logger: log }).complete(request())

    expect(reply.text).toBe('uno dos')
    expect(reply.toolCalls).toEqual([])
  })

  test('a 200 response with no output is an error', async () => {
    stubFetch(async () => Response.json({}))

    await expect(conversationModel({ config, logger: log }).complete(request())).rejects.toThrow(/no output/)
  })

  test('a 500 is retried once and the retry keeps the cost controls', async () => {
    const calls = stubFetch(async () => {
      if (calls.count() === 1)
        return new Response('upstream exploded', { status: 500 })

      return textPayload('va')
    })

    await conversationModel({ config, logger: log }).complete(request())

    expect(calls.count()).toBe(2)
    expect(sentBody(calls, 1).store).toBe(false)
    expect(sentBody(calls, 1).max_output_tokens).toBe(800)
  })

  test('a connection failure is retried once', async () => {
    let calls = 0

    stubFetch(async () => {
      calls++

      if (calls === 1)
        throw new TypeError('fetch failed')

      return textPayload('va')
    })

    await conversationModel({ config, logger: log }).complete(request())

    expect(calls).toBe(2)
  })

  test('a timed-out request is not retried', async () => {
    let calls = 0

    stubFetch(async () => {
      calls++

      const error = new Error('timed out')
      error.name = 'TimeoutError'

      throw error
    })

    await expect(conversationModel({ config, logger: log }).complete(request()))
      .rejects
      .toThrow(/timed out/)
    expect(calls).toBe(1)
  })

  test('a retry without budget fails closed instead of starting again', async () => {
    const realNow = Date.now
    let now = 1_000

    stubFetch(async () => {
      now = 2_000

      return new Response('upstream exploded', { status: 500 })
    })

    try {
      Date.now = () => now
      await expect(conversationModel({ config, logger: log }).complete(request()))
        .rejects
        .toThrow(/ran out of time/)
    }
    finally {
      Date.now = realNow
    }
  })

  test('a 400 is not retried and the error body is truncated', async () => {
    let calls = 0

    stubFetch(async () => {
      calls++

      return new Response('x'.repeat(5_000), { status: 400 })
    })

    const error = await conversationModel({ config, logger: log }).complete(request()).catch((caught: unknown) => caught)

    expect(calls).toBe(1)
    expect(error).toBeInstanceOf(ProviderError)

    if (!(error instanceof ProviderError))
      throw new Error('expected a provider error')

    expect(error.message).toContain('400')
    expect(error.message.length).toBeLessThan(400)
  })

  test('an explicit output cap overrides the default', async () => {
    const calls = stubFetch(async () => textPayload('va'))

    await conversationModel({ config, logger: log }).complete(request({ maxOutputTokens: 200 }))

    expect(sentBody(calls, 0).max_output_tokens).toBe(200)
  })

  test('the session and the key travel in the headers', async () => {
    const seen: { session: string | null, authorization: string | null } = { session: null, authorization: null }

    stubFetch(async (_input, init) => {
      const headers = new Headers(init?.headers)

      seen.session = headers.get('x-opencode-session')
      seen.authorization = headers.get('Authorization')

      return textPayload('va')
    })

    await conversationModel({ config, logger: log }).complete(request({ sessionId: 'chan-9' }))

    expect(seen.session).toBe('chan-9')
    expect(seen.authorization).toBe('Bearer test-key')
  })
})
