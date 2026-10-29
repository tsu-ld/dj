import type { Channel, Message } from 'discord.js'

export interface Mention {
  readonly botMentioned: boolean
  readonly channelMentions: readonly Channel[]
  readonly text: string
}

function stripBotMention(content: string, botId: string): string {
  return content.replaceAll(`<@${botId}>`, '').replaceAll(`<@!${botId}>`, '')
}

// The users collection is the API's parsed mention list, not a name that looks
// like one. Channel mentions come from the same list and are not render-aware:
// a channel id inside backticks still counts, so set_channel keeps its admin
// permission check.
export function readMention(message: Message): Mention {
  const botId = message.client.user?.id
  const botMentioned = botId !== undefined && message.mentions.users.has(botId)
  const channelMentions = [...message.mentions.channels.values()]
  const text = (botMentioned && botId ? stripBotMention(message.content, botId) : message.content).trim()

  return { botMentioned, channelMentions, text }
}

// "@DJ #music" is onboarding, not a command the model has to infer. The same
// channel named twice is still one Discord mention in the collection.
export function isChannelConfiguration(text: string, channelMentions: readonly { readonly id: string }[]): boolean {
  if (channelMentions.length !== 1)
    return false

  const [channel] = channelMentions

  return channel !== undefined && text.replaceAll(`<#${channel.id}>`, '').trim() === ''
}
