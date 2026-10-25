import process from 'node:process'
import { afterEach, expect, test } from 'bun:test'
import { requestCompletion } from '../client.js'

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
