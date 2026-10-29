import process from 'node:process'
import { afterEach, expect, spyOn, test } from 'bun:test'
import { isConfigured, requestCompletion } from '../client.js'

const realFetch = globalThis.fetch

function stubCompletionApi(text) {
  const bodies = []

  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body))

    return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] })
  }
  process.env.OPENAI_BASE_URL = 'https://llm.example.com/v1/responses'
  process.env.OPENAI_API_KEY = 'test-key'

  return bodies
}

afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_KEY
})

test('a request with tools asks the endpoint to pick them', async () => {
  const tools = [{ type: 'function', function: { name: 'skip_song', parameters: {} } }]
  const bodies = stubCompletionApi('va')

  await requestCompletion({ messages: [{ role: 'user', content: 'skippea' }], tools, timeoutMs: 1000, sessionId: 'chan-1' })

  expect(bodies[0].tools).toEqual([{ type: 'function', name: 'skip_song', description: undefined, parameters: {} }])
  expect(bodies[0].tool_choice).toBe('auto')
})

test('a request without tools sends neither key', async () => {
  const bodies = stubCompletionApi('va')

  await requestCompletion({ messages: [{ role: 'user', content: 'que suena?' }], timeoutMs: 1000, sessionId: 'chan-1' })

  expect(bodies[0].tools).toBeUndefined()
  expect(bodies[0].tool_choice).toBeUndefined()
  expect(bodies[0].reasoning).toBeUndefined()
})

test('a request can turn reasoning off for a fast answer', async () => {
  const bodies = stubCompletionApi('va')

  await requestCompletion({
    messages: [{ role: 'user', content: 'presentá el tema' }],
    timeoutMs: 1000,
    sessionId: 'chan-1',
    reasoningEffort: 'none',
  })

  expect(bodies[0].reasoning).toEqual({ effort: 'none' })
})

test('system messages become instructions', async () => {
  const bodies = stubCompletionApi('va')

  await requestCompletion({
    messages: [
      { role: 'system', content: 'sos un dj' },
      { role: 'user', content: 'que suena?' },
    ],
    timeoutMs: 1000,
    sessionId: 'chan-1',
  })

  expect(bodies[0].instructions).toBe('sos un dj')
  expect(bodies[0].input).toEqual([{ role: 'user', content: 'que suena?' }])
})

test('tool calls round-trip between chat and responses shapes', async () => {
  const bodies = []
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body))

    return Response.json({ output: [{ type: 'function_call', call_id: 'call_1', name: 'skip_song', arguments: '{}' }] })
  }
  process.env.OPENAI_BASE_URL = 'https://llm.example.com/v1/responses'
  process.env.OPENAI_API_KEY = 'test-key'

  const reply = await requestCompletion({ messages: [{ role: 'user', content: 'skippea' }], timeoutMs: 1000, sessionId: 'chan-1' })

  expect(reply.tool_calls).toEqual([{ id: 'call_1', type: 'function', function: { name: 'skip_song', arguments: '{}' } }])
  expect(reply.content).toBe(null)

  await requestCompletion({
    messages: [
      { role: 'assistant', content: null, tool_calls: reply.tool_calls },
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
    ],
    timeoutMs: 1000,
    sessionId: 'chan-1',
  })

  expect(bodies[1].input).toEqual([
    { type: 'function_call', call_id: 'call_1', name: 'skip_song', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
  ])
})

test('a 200 response with no output is an error', async () => {
  process.env.OPENAI_BASE_URL = 'https://llm.example.com/v1/responses'
  process.env.OPENAI_API_KEY = 'test-key'
  globalThis.fetch = async () => Response.json({})

  await expect(requestCompletion({ messages: [{ role: 'user', content: 'que suena?' }], timeoutMs: 1000, sessionId: 'chan-1' })).rejects.toThrow(/no output/)
})

test('a 500 is retried once and the retry keeps the cost controls', async () => {
  const bodies = []
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    calls++

    if (calls === 1)
      return new Response('upstream exploded', { status: 500 })

    return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'va' }] }] })
  }
  process.env.OPENAI_BASE_URL = 'https://llm.example.com/v1/responses'
  process.env.OPENAI_API_KEY = 'test-key'

  await requestCompletion({ messages: [{ role: 'user', content: 'que suena?' }], timeoutMs: 1000, sessionId: 'chan-1' })

  expect(calls).toBe(2)
  expect(bodies[1].store).toBe(false)
  expect(bodies[1].max_output_tokens).toBe(800)
})

test('a timed-out request is not retried', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    const error = new Error('timed out')
    error.name = 'TimeoutError'
    throw error
  }
  process.env.OPENAI_BASE_URL = 'https://llm.example.com/v1/responses'
  process.env.OPENAI_API_KEY = 'test-key'

  await expect(requestCompletion({ messages: [{ role: 'user', content: 'que suena?' }], timeoutMs: 1000, sessionId: 'chan-1' }))
    .rejects
    .toThrow(/timed out/)
  expect(calls).toBe(1)
})

test('a retry without budget fails closed instead of starting again', async () => {
  const clock = spyOn(Date, 'now').mockReturnValue(1_000)
  globalThis.fetch = async () => {
    clock.mockReturnValue(2_000)

    return new Response('upstream exploded', { status: 500 })
  }
  process.env.OPENAI_BASE_URL = 'https://llm.example.com/v1/responses'
  process.env.OPENAI_API_KEY = 'test-key'

  try {
    await expect(requestCompletion({ messages: [{ role: 'user', content: 'que suena?' }], timeoutMs: 1000, sessionId: 'chan-1' }))
      .rejects
      .toThrow(/ran out of time/)
  }
  finally {
    clock.mockRestore()
  }
})

test('a 400 is not retried and the error body is truncated', async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls++

    return new Response('x'.repeat(5000), { status: 400 })
  }
  process.env.OPENAI_BASE_URL = 'https://llm.example.com/v1/responses'
  process.env.OPENAI_API_KEY = 'test-key'

  const error = await requestCompletion({ messages: [{ role: 'user', content: 'que suena?' }], timeoutMs: 1000, sessionId: 'chan-1' })
    .catch(caught => caught)

  expect(calls).toBe(1)
  expect(error.message).toContain('400')
  expect(error.message.length).toBeLessThan(400)
})

test('an explicit output cap overrides the default', async () => {
  const bodies = stubCompletionApi('va')

  await requestCompletion({
    messages: [{ role: 'user', content: 'anuncia' }],
    timeoutMs: 1000,
    sessionId: 'chan-1',
    maxOutputTokens: 200,
  })

  expect(bodies[0].max_output_tokens).toBe(200)
})

test('isConfigured needs both the endpoint and the key', () => {
  expect(isConfigured()).toBe(false)

  process.env.OPENAI_BASE_URL = 'https://llm.example.com/v1/responses'
  expect(isConfigured()).toBe(false)

  process.env.OPENAI_API_KEY = 'test-key'
  expect(isConfigured()).toBe(true)
})
