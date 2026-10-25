import { expect, test } from 'bun:test'
import { createMessageHandler } from '../route-message.js'

const store = { get: () => ({ textChannelId: '2', persona: null }) }
const handler = createMessageHandler(store)
const bot = { id: '999' }

function message(overrides) {
  return {
    author: { bot: false },
    guildId: '123456789012345678',
    channelId: '2',
    channel: { isTextBased: () => true },
    client: { user: bot },
    mentions: { members: new Map(), channels: new Map() },
    content: 'hola',
    ...overrides,
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
