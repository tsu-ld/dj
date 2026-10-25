export function readMention(message) {
  const botId = message.client.user.id
  const botMentioned = message.mentions.members?.has(botId) ?? false
  const channelMentions = [...message.mentions.channels.values()]
  const text = (botMentioned ? stripBotMention(message.content, botId) : message.content).trim()

  return { botMentioned, channelMentions, text }
}

function stripBotMention(content, botId) {
  return content.replaceAll(`<@${botId}>`, '').replaceAll(`<@!${botId}>`, '')
}

// "@DJ #music" is onboarding, not a command the model has to infer. The same
// channel named twice is still one Discord mention in the collection.
export function isChannelConfiguration(text, channelMentions) {
  if (channelMentions.length !== 1)
    return false

  return text.replaceAll(`<#${channelMentions[0].id}>`, '').trim() === ''
}
