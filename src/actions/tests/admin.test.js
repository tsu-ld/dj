import { expect, test } from 'bun:test'
import { MESSAGES } from '../../messages/en.js'
import { getAction } from '../index.js'

const allowed = { permissions: { has: () => true } }
const denied = { permissions: { has: () => false } }

function message(content, channels = []) {
  return {
    content,
    mentions: { channels: new Map(channels.map(channel => [channel.id, channel])) },
    guild: { members: { me: {} }, channels: { fetch: async id => channels.find(channel => channel.id === id) ?? null } },
  }
}

function memoryStore() {
  const updates = []

  return {
    updates,
    updateGuild: async (guildId, changes) => updates.push([guildId, changes]),
  }
}

const textChannel = { id: '456', name: 'music', guild: {}, isTextBased: () => true, toString: () => '<#456>', permissionsFor: () => ({ has: () => true }) }
const otherChannel = { id: '789', name: 'general', guild: {}, isTextBased: () => true, toString: () => '<#789>', permissionsFor: () => ({ has: () => true }) }

test('permissions gate persona changes before the message intent', async () => {
  await expect(getAction('set_persona').run(
    { persona: 'un dj' },
    { member: denied, guildId: 'g1', store: memoryStore() },
  )).rejects.toThrow(MESSAGES.personaPermission)
})

test('a persona change needs the intent in the user message', async () => {
  await expect(getAction('set_persona').run(
    { persona: 'un dj' },
    { member: allowed, guildId: 'g1', store: memoryStore(), message: message('<@999> hola') },
  )).rejects.toThrow(MESSAGES.personaExplicit)
})

test('a persona change is accepted when the user asks for it', async () => {
  const store = memoryStore()

  const result = await getAction('set_persona').run(
    { persona: '  un dj  ' },
    { member: allowed, guildId: 'g1', store, message: message('<@999> sé un dj') },
  )

  expect(result).toEqual({ persona: 'un dj' })
  expect(store.updates).toEqual([['g1', { persona: 'un dj' }]])
})

test('a persona change accepts a comma after the mention and english', async () => {
  for (const content of ['<@999>, sé un dj', '<@999> speak like a pirate', '<@999> talk like a cumbiero']) {
    const store = memoryStore()

    await getAction('set_persona').run(
      { persona: 'un dj' },
      { member: allowed, guildId: 'g1', store, message: message(content) },
    )

    expect(store.updates).toHaveLength(1)
  }
})

test('a word that only starts like the persona trigger is not enough', async () => {
  await expect(getAction('set_persona').run(
    { persona: 'un dj' },
    { member: allowed, guildId: 'g1', store: memoryStore(), message: message('<@999> seguí con la música') },
  )).rejects.toThrow(MESSAGES.personaExplicit)
})

test('permissions gate channel changes before the mention', async () => {
  await expect(getAction('set_channel').run(
    { channelId: textChannel.id },
    { member: denied, guildId: 'g1', store: memoryStore() },
  )).rejects.toThrow(MESSAGES.channelConfigurePermission)
})

test('a channel change without a mention is rejected', async () => {
  await expect(getAction('set_channel').run(
    { channelId: textChannel.id },
    { member: allowed, guildId: 'g1', store: memoryStore(), message: message('<@999> escuchá en music') },
  )).rejects.toThrow(MESSAGES.channelExplicit)
})

test('a channel change uses the single mentioned channel, not the model argument', async () => {
  const store = memoryStore()

  const result = await getAction('set_channel').run(
    { channelId: otherChannel.id },
    { member: allowed, guildId: 'g1', store, message: message(`<@999> escuchá en <#${textChannel.id}>`, [textChannel]) },
  )

  expect(result).toEqual({ channelId: textChannel.id, channelName: textChannel.name })
  expect(store.updates).toEqual([['g1', { textChannelId: textChannel.id }]])
})

test('a channel where the bot cannot read or send is rejected', async () => {
  const blocked = { ...textChannel, permissionsFor: () => ({ has: () => false }) }

  await expect(getAction('set_channel').run(
    { channelId: blocked.id },
    {
      member: allowed,
      guildId: 'g1',
      store: memoryStore(),
      message: message(`<@999> escuchá en <#${blocked.id}>`, [blocked]),
    },
  )).rejects.toThrow(MESSAGES.textChannelPermissions)
})

test('a channel change with two mentions is rejected', async () => {
  await expect(getAction('set_channel').run(
    { channelId: textChannel.id },
    {
      member: allowed,
      guildId: 'g1',
      store: memoryStore(),
      message: message(`<@999> escuchá en <#${textChannel.id}> o <#${otherChannel.id}>`, [textChannel, otherChannel]),
    },
  )).rejects.toThrow(MESSAGES.channelExplicit)
})
