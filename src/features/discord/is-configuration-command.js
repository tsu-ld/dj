export function isConfigurationCommand(message, botUser) {
  return message.mentions.has(botUser) && message.mentions.channels.size > 0
}
