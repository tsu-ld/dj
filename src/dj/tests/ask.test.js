import process from 'node:process'
import { afterEach, expect, spyOn, test } from 'bun:test'
import { MESSAGES } from '../../messages/en.js'
import { askDj } from '../ask.js'

const realFetch = globalThis.fetch

function stubFetch(responses) {
  const bodies = []
  let index = 0

  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body))

    return Response.json(responses[Math.min(index++, responses.length - 1)])
  }
  process.env.OPENAI_BASE_URL = 'https://llm.example.com/v1/responses'
  process.env.OPENAI_API_KEY = 'test-key'

  return bodies
}

function textResponse(text) {
  return { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
}

function toolResponse(callId, name, args) {
  return { output: [{ type: 'function_call', call_id: callId, name, arguments: args }] }
}

function message(overrides = {}) {
  return {
    guildId: '123456789012345678',
    channelId: 'ask-channel',
    author: { id: 'user-1' },
    member: {},
    channel: { sendTyping: async () => {} },
    ...overrides,
  }
}

afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_KEY
})

test('a request without an author still answers through the channel history', async () => {
  const bodies = stubFetch([textResponse('hola')])

  const reply = await askDj({
    message: message({ channelId: 'ask-fallback', author: undefined }),
    settings: { persona: null },
    request: 'hola',
    store: {},
  })

  expect(reply).toBe('hola')
  expect(bodies[0].store).toBe(false)
})

test('tool calls over the per-round cap still get a result', async () => {
  const calls = Array.from({ length: 5 }, (_, index) => ({ index }))
  const first = {
    output: calls.map(({ index }) => ({
      type: 'function_call',
      call_id: `call_${index}`,
      name: 'nope',
      arguments: '{}',
    })),
  }
  const bodies = stubFetch([first, textResponse('listo')])

  const reply = await askDj({
    message: message({ channelId: 'ask-cap' }),
    settings: { persona: null },
    request: 'hacelo',
    store: {},
  })

  expect(reply).toBe('listo')

  const results = bodies[1].input.filter(item => item.type === 'function_call_output')

  expect(results).toHaveLength(5)
  expect(results.at(-1).output).toContain('too many tool calls')
})

test('the deadline stops tool rounds and throws when nothing happened', async () => {
  const clock = spyOn(Date, 'now').mockReturnValue(1_000_000)
  stubFetch([toolResponse('call_1', 'nope', '{}')])
  const fetchStub = globalThis.fetch

  globalThis.fetch = async (url, init) => {
    clock.mockReturnValue(1_000_000 + 60_001)

    return fetchStub(url, init)
  }

  try {
    await expect(askDj({
      message: message({ channelId: 'ask-deadline' }),
      settings: { persona: null },
      request: 'hacelo',
      store: {},
    })).rejects.toThrow(/ran out of time/)
  }
  finally {
    clock.mockRestore()
  }
})

test('the deadline after acting returns the short confirmation', async () => {
  const clock = spyOn(Date, 'now').mockReturnValue(1_000_000)
  const updates = []
  const store = {
    updateGuild: async (guildId, changes) => {
      updates.push([guildId, changes])
      clock.mockReturnValue(1_000_000 + 60_001)
    },
  }
  stubFetch([toolResponse('call_1', 'set_persona', '{"persona":"un dj"}')])

  try {
    const reply = await askDj({
      message: message({
        channelId: 'ask-deadline-acted',
        content: '<@999> sé un dj',
        member: { permissions: { has: () => true } },
      }),
      settings: { persona: null },
      request: 'sé un dj',
      store,
    })

    expect(reply).toBe(MESSAGES.djActed)
    expect(updates).toEqual([['123456789012345678', { persona: 'un dj' }]])
  }
  finally {
    clock.mockRestore()
  }
})
