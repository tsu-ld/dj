import { expect, test } from 'bun:test'
import { isChannelConfiguration, readMention } from '../mentions.js'

const BOT_ID = '123'
const MUSIC = { id: '456', name: 'music' }

function message(content, { mentioned = true, channels = [] } = {}) {
  return {
    client: { user: { id: BOT_ID } },
    content,
    mentions: {
      members: mentioned ? new Map([[BOT_ID, {}]]) : new Map(),
      channels: new Map(channels.map(channel => [channel.id, channel])),
    },
  }
}

test('a bot mention is stripped from the request', () => {
  expect(readMention(message(`<@${BOT_ID}> pausá`))).toEqual({
    botMentioned: true,
    channelMentions: [],
    text: 'pausá',
  })
  expect(readMention(message(`<@!${BOT_ID}> pausá`)).text).toBe('pausá')
})

test('without a real mention the text is left alone', () => {
  expect(readMention(message('never gonna give you up', { mentioned: false }))).toEqual({
    botMentioned: false,
    channelMentions: [],
    text: 'never gonna give you up',
  })
})

test('a mention inside a code block is not a real mention', () => {
  const content = `\`<@${BOT_ID}> <#${MUSIC.id}>\``

  expect(readMention(message(content, { mentioned: false }))).toEqual({
    botMentioned: false,
    channelMentions: [],
    text: content,
  })
})

test('channel mentions travel with the message', () => {
  const result = readMention(message(`<@${BOT_ID}> escuchá en <#${MUSIC.id}>`, { channels: [MUSIC] }))

  expect(result.channelMentions).toEqual([MUSIC])
  expect(result.text).toBe(`escuchá en <#${MUSIC.id}>`)
})

test('a mention plus exactly one channel configures it', () => {
  expect(isChannelConfiguration(`<#${MUSIC.id}>`, [MUSIC])).toBe(true)
  expect(isChannelConfiguration(`<#${MUSIC.id}> <#${MUSIC.id}>`, [MUSIC])).toBe(true)
})

test('extra words or several channels are a request, not a config', () => {
  const other = { id: '789', name: 'general' }

  expect(isChannelConfiguration(`escuchá en <#${MUSIC.id}>`, [MUSIC])).toBe(false)
  expect(isChannelConfiguration(`<#${MUSIC.id}> <#${other.id}>`, [MUSIC, other])).toBe(false)
  expect(isChannelConfiguration('<#456> please', [MUSIC])).toBe(false)
})
