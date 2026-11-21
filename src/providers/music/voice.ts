import { ChannelType, PermissionFlagsBits } from 'discord.js'
import { MESSAGES } from '../../messages.ts'

interface GuildLike {
  readonly members: { readonly me: unknown }
}

interface VoiceChannelLike {
  readonly type: ChannelType
  readonly guild?: GuildLike
  permissionsFor(member: unknown): { has(permission: ReadonlyArray<bigint>): boolean } | null
}

export function voiceChannelProblem(voiceChannel: VoiceChannelLike): string | null {
  if (voiceChannel.type === ChannelType.GuildStageVoice) {
    return MESSAGES.stageChannelPermissions
  }

  const me = voiceChannel.guild?.members.me
  const permissions = me === undefined || me === null ? null : voiceChannel.permissionsFor(me)

  if (
    permissions === null ||
    !permissions.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])
  ) {
    return MESSAGES.botPermissions
  }

  return null
}
