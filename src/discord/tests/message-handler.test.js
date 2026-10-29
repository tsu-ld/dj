import process from 'node:process'
import { expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.js'
import { createMessageHandler } from '../route-message.js'

const store = { get: () => ({ textChannelId: '2', persona: null }) }
const handler = createMessageHandler(store)
const bot = { id: '999' }

function message(overrides) {
  return {
    author: { bot: false, id: 'user-1' },
    guildId: '123456789012345678',
    channelId: '2',
    channel: { isTextBased: () => true },
    client: { user: bot },
    mentions: { members: new Map(), channels: new Map() },
    content: 'hola',
    reply: async () => {},
    ...overrides,
  }
}

function mentioned() {
  return { members: new Map([[bot.id, {}]]), channels: new Map() }
}

function repliesFor(overrides) {
  const replies = []
  const msg = message({ ...overrides, reply: async text => replies.push(text) })

  return { msg, replies }
}

async function withoutLlm(run) {
  const keys = ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'JEV_BASE_URL']
  const saved = new Map(keys.map(key => [key, process.env[key]]))

  for (const key of keys)
    delete process.env[key]

  try {
    return await run()
  }
  finally {
    for (const [key, value] of saved) {
      if (value !== undefined)
        process.env[key] = value
    }
  }
}

test('a bot message returns before touching the player', async () => {
  await expect(handler(message({ author: { bot: true } }))).resolves.toBeUndefined()
})

test('a direct message returns before touching the player', async () => {
  await expect(handler(message({ guildId: null }))).resolves.toBeUndefined()
})

test('a non-text channel returns before touching the player', async () => {
  await expect(handler(message({ channel: { isTextBased: () => false } }))).resolves.toBeUndefined()
})

test('an empty mention in the listening channel asks for the request', async () => {
  const { msg, replies } = repliesFor({ content: '<@999>', mentions: mentioned() })

  await withoutLlm(() => handler(msg))

  expect(replies).toEqual([MESSAGES.emptyMention])
})

test('a mention outside the listening channel points at it', async () => {
  const { msg, replies } = repliesFor({ channelId: '3', content: '<@999> hola', mentions: mentioned() })

  await withoutLlm(() => handler(msg))

  expect(replies).toEqual([MESSAGES.wrongChannel('2')])
})

test('a mention outside the listening channel is never ignored when none is set', async () => {
  const noChannelHandler = createMessageHandler({ get: () => ({ textChannelId: null, persona: null }) })
  const { msg, replies } = repliesFor({ channelId: '3', content: '<@999> hola', mentions: mentioned() })

  await withoutLlm(() => noChannelHandler(msg))

  expect(replies).toEqual([MESSAGES.emptyMention])
})

test('a dj request without an LLM says it is unavailable', async () => {
  const { msg, replies } = repliesFor({ content: '<@999> poneme algo tranqui', mentions: mentioned() })

  await withoutLlm(() => handler(msg))

  expect(replies).toEqual([MESSAGES.djUnavailable])
})

test('two plain queries from the same user are rate limited', async () => {
  const first = repliesFor({ guildId: '222222222222222222', author: { bot: false, id: 'rate-user' } })
  const second = repliesFor({ guildId: '222222222222222222', author: { bot: false, id: 'rate-user' } })

  await withoutLlm(async () => {
    await handler(first.msg)
    await handler(second.msg)
  })

  expect(first.replies).toEqual([MESSAGES.joinVoiceChannel])
  expect(second.replies).toEqual([MESSAGES.rateLimited])
})
