import { ChannelType, PermissionFlagsBits } from 'discord.js'
import { MESSAGES } from '../messages/en.js'

// The same checks gate every path into the voice channel: a direct query or the
// dj's own tool calls must not join where the bot cannot speak.
export function voiceChannelProblem(voiceChannel, guild = voiceChannel?.guild) {
  if (!voiceChannel)
    return MESSAGES.joinVoiceChannel

  if (voiceChannel.type === ChannelType.GuildStageVoice)
    return MESSAGES.stageChannelPermissions

  const me = guild?.members?.me
  const permissions = me ? voiceChannel.permissionsFor(me) : null

  if (!permissions?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]))
    return MESSAGES.botPermissions

  return null
}
