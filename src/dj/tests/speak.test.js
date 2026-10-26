import process from 'node:process'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { refuse, say } from '../speak.js'

const realFetch = globalThis.fetch
const keys = ['OPENAI_BASE_URL', 'OPENAI_API_KEY']

function message() {
  const replies = []

  return {
    replies,
    channel: { id: 'chan-1', sendTyping: async () => {} },
    reply: async text => replies.push(text),
  }
}

beforeEach(() => {
  for (const key of keys)
    delete process.env[key]
})

afterEach(() => {
  globalThis.fetch = realFetch

  for (const key of keys)
    delete process.env[key]
})

test('without an llm a refusal still carries its reason', async () => {
  const msg = message()

  await refuse(msg, { persona: null }, 'I need permissions to join.')

  expect(msg.replies).toEqual(['I need permissions to join.'])
})

test('without an llm say falls back to the plain text', async () => {
  const msg = message()

  await say(msg, { persona: null }, 'Done.')

  expect(msg.replies).toEqual(['Done.'])
})
