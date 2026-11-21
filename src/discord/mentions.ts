import type { Channel, Message } from 'discord.js'

interface Mention {
  readonly botMentioned: boolean
  readonly channelMentions: ReadonlyArray<Channel>
  readonly text: string
}

function stripBotMention(content: string, botId: string): string {
  return content.replaceAll(`<@${botId}>`, '').replaceAll(`<@!${botId}>`, '')
}

export function readMention(message: Message): Mention {
  const botId = message.client.user?.id
  const botMentioned = botId !== undefined && message.mentions.users.has(botId)
  const channelMentions = [...message.mentions.channels.values()]
  const text = (botMentioned ? stripBotMention(message.content, botId) : message.content).trim()

  return { botMentioned, channelMentions, text }
}

export function isChannelConfiguration(
  text: string,
  channelMentions: ReadonlyArray<{ readonly id: string }>,
): boolean {
  if (channelMentions.length !== 1) {
    return false
  }

  const [channel] = channelMentions

  return channel !== undefined && text.replaceAll(`<#${channel.id}>`, '').trim() === ''
}
