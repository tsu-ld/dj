import type { CommandContext } from './spec.ts'
import { UserError } from '../core/errors.ts'
import { MESSAGES } from '../messages.ts'

// Playback controls act on the bot's own audio session: someone in a different
// voice channel would change what another channel is hearing. While the bot is
// disconnected there is no session to protect, so the command's own
// preconditions decide.
export function requireSameVoiceChannel(context: CommandContext): void {
  const botChannelId = context.member.guild.members.me?.voice.channelId ?? null

  if (botChannelId === null)
    return

  if (context.voiceChannel?.id !== botChannelId)
    throw new UserError(MESSAGES.sameVoiceChannel)
}
