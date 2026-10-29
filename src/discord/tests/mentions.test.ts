import { describe, expect, test } from 'bun:test'
import { isChannelConfiguration, readMention } from '../mentions.ts'
import { fakeIncomingMessage } from './fakes.ts'

const BOT_ID = '123'
const MUSIC = { id: '456', name: 'music' }

function mention(content: string, { mentioned = true, channels = [] }: { mentioned?: boolean, channels?: typeof MUSIC[] } = {}): ReturnType<typeof readMention> {
  return readMention(fakeIncomingMessage({
    content,
    botId: BOT_ID,
    users: mentioned ? new Map([[BOT_ID, {}]]) : new Map(),
    channels: new Map(channels.map(channel => [channel.id, channel])),
  }).message)
}

describe('readMention', () => {
  test('a bot mention is stripped from the request', () => {
    expect(mention(`<@${BOT_ID}> pausá`)).toEqual({
      botMentioned: true,
      channelMentions: [],
      text: 'pausá',
    })
    expect(mention(`<@!${BOT_ID}> pausá`).text).toBe('pausá')
  })

  test('without a real mention the text is left alone', () => {
    expect(mention('never gonna give you up', { mentioned: false })).toEqual({
      botMentioned: false,
      channelMentions: [],
      text: 'never gonna give you up',
    })
  })

  test('a mention inside a code block is not a real mention', () => {
    const content = `\`<@${BOT_ID}> <#${MUSIC.id}>\``

    expect(mention(content, { mentioned: false })).toEqual({
      botMentioned: false,
      channelMentions: [],
      text: content,
    })
  })

  test('channel mentions travel with the message', () => {
    const result = mention(`<@${BOT_ID}> escuchá en <#${MUSIC.id}>`, { channels: [MUSIC] })

    expect(result.channelMentions.map(channel => channel.id)).toEqual([MUSIC.id])
    expect(result.text).toBe(`escuchá en <#${MUSIC.id}>`)
  })
})

describe('isChannelConfiguration', () => {
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
})
