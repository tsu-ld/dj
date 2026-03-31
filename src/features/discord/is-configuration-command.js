export function isConfigurationCommand(message) {
  return message.mentions.has(message.client.user) && message.mentions.channels.size > 0
}
