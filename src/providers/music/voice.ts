import { ChannelType, PermissionFlagsBits } from 'discord.js'
import { MESSAGES } from '../../messages.ts'

interface GuildLike {
  readonly members: { readonly me: unknown }
}

// discord.js declares these as methods; function properties would be contravariant and reject the real channel
/* eslint-disable ts/method-signature-style */
interface VoiceChannelLike {
  readonly type: ChannelType
  readonly guild?: GuildLike
  permissionsFor(member: unknown): { has(permission: readonly bigint[]): boolean } | null
}
/* eslint-enable ts/method-signature-style */

export function voiceChannelProblem(voiceChannel: VoiceChannelLike): string | null {
  if (voiceChannel.type === ChannelType.GuildStageVoice)
    return MESSAGES.stageChannelPermissions

  const me = voiceChannel.guild?.members.me
  const permissions = me === undefined || me === null ? null : voiceChannel.permissionsFor(me)

  if (permissions === null || !permissions.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]))
    return MESSAGES.botPermissions

  return null
}
