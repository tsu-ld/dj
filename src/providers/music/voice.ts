import { ChannelType, PermissionFlagsBits } from 'discord.js'
import { MESSAGES } from '../../messages.ts'

export interface GuildLike {
  readonly members: { readonly me: unknown }
}

// The SDK's channel methods are declared as methods: turning them into function
// properties makes their parameters contravariant and rejects the real channel.
/* eslint-disable ts/method-signature-style */
export interface VoiceChannelLike {
  readonly type: ChannelType
  readonly guild?: GuildLike
  permissionsFor(member: unknown): { has(permission: readonly bigint[]): boolean } | null
}
/* eslint-enable ts/method-signature-style */

// The same checks gate every path into the voice channel: a direct query or the
// dj's own tool calls must not join where the bot cannot speak.
export function voiceChannelProblem(
  voiceChannel: VoiceChannelLike | null,
  guild: GuildLike | undefined = voiceChannel?.guild,
): string | null {
  if (!voiceChannel)
    return MESSAGES.joinVoiceChannel

  if (voiceChannel.type === ChannelType.GuildStageVoice)
    return MESSAGES.stageChannelPermissions

  const me = guild?.members.me
  const permissions = me === undefined || me === null ? null : voiceChannel.permissionsFor(me)

  if (permissions === null || !permissions.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]))
    return MESSAGES.botPermissions

  return null
}
