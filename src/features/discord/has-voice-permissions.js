import { PermissionFlagsBits } from 'discord.js'

export function hasVoicePermissions(voiceChannel, message) {
  const me = message.guild?.members?.me ?? message.client.user
  const perms = voiceChannel.permissionsFor(me)
  const canConnect = perms?.has(PermissionFlagsBits.Connect)
  const canSpeak = perms?.has(PermissionFlagsBits.Speak)

  return canConnect && canSpeak
}
