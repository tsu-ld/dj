export function getUserVoiceChannel(message) {
  return message.member?.voice?.channel ?? null
}
