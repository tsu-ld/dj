import process from 'node:process'
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { chooseAction, resetDecisionCooldown } from '../decide.js'

const realFetch = globalThis.fetch
const OPTIONS = [
  { name: 'pause', description: 'Pause the music.' },
  { name: 'skip', description: 'Skip the current song.' },
  { name: 'dj', description: 'Everything else.' },
]

function stubJev(answer) {
  const bodies = []

  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body))

    return Response.json({ answers: { action: answer } })
  }
  process.env.JEV_BASE_URL = 'https://jev.example.com/v1/systemone'
  process.env.JEV_API_KEY = 'test-key'

  return bodies
}

beforeEach(() => {
  globalThis.fetch = realFetch
  resetDecisionCooldown()
  delete process.env.JEV_BASE_URL
  delete process.env.JEV_API_KEY
  delete process.env.JEV_MODEL
})

afterEach(() => {
  globalThis.fetch = realFetch
  resetDecisionCooldown()
  delete process.env.JEV_BASE_URL
  delete process.env.JEV_API_KEY
  delete process.env.JEV_MODEL
})

test('the decision sends the message, the state and the registered options', async () => {
  const bodies = stubJev({ choice: 'pause', confidence: 0.9 })

  const choice = await chooseAction({
    text: 'pausá',
    state: { author_in_voice: true },
    options: OPTIONS,
  })

  expect(choice).toBe('pause')
  expect(bodies[0].model).toBe('jev-1.13-free')
  expect(bodies[0].state).toEqual({ message: 'pausá', author_in_voice: true })
  expect(Object.keys(bodies[0].questions.action.criteria)).toEqual(['pause', 'skip', 'dj'])
})

test('a low-confidence decision falls back to the dj', async () => {
  stubJev({ choice: 'pause', confidence: 0.4 })

  expect(await chooseAction({ text: 'pausá', state: {}, options: OPTIONS })).toBeNull()
})

test('a label outside the offered options falls back to the dj', async () => {
  stubJev({ choice: 'set_persona', confidence: 0.9 })

  expect(await chooseAction({ text: 'sé un dj', state: {}, options: OPTIONS })).toBeNull()
})

test('without an endpoint there is no decision call', async () => {
  let called = false

  globalThis.fetch = async () => {
    called = true

    return Response.json({})
  }

  expect(await chooseAction({ text: 'pausá', state: {}, options: OPTIONS })).toBeNull()
  expect(called).toBe(false)
})

test('a failed decision rejects so the caller can fall back', async () => {
  process.env.JEV_BASE_URL = 'https://jev.example.com/v1/systemone'
  process.env.JEV_API_KEY = 'test-key'
  let calls = 0
  globalThis.fetch = async () => {
    calls++

    return Response.json({ error: 'slow down' }, { status: 429 })
  }

  await expect(chooseAction({ text: 'pausá', state: {}, options: OPTIONS })).rejects.toThrow(/429/)
  expect(await chooseAction({ text: 'pausá', state: {}, options: OPTIONS })).toBeNull()
  expect(calls).toBe(1)
})
