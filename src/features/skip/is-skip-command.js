export function isSkipCommand(message) {
  const mentionsBot = message.mentions.has(message.client.user)
  const content = message.content.toLowerCase()

  return mentionsBot && content.includes('skip')
}
