import type { CommandContext } from './spec.ts'
import { UserError } from '../core/errors.ts'
import { MESSAGES } from '../messages.ts'

export function requireSameVoiceChannel(context: CommandContext): void {
  const botChannelId = context.member.guild.members.me?.voice.channelId ?? null

  if (botChannelId === null) {
    return
  }

  if (context.voiceChannel?.id !== botChannelId) {
    throw new UserError(MESSAGES.sameVoiceChannel)
  }
}
