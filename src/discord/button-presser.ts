import type { ButtonInteraction, GuildMember, GuildTextBasedChannel } from 'discord.js'
import type { Logger } from '../core/logger.ts'
import { errorMessage } from '../core/errors.ts'

export function textChannelOf(interaction: ButtonInteraction): GuildTextBasedChannel | null {
  const channel = interaction.channel

  if (!channel || !channel.isTextBased() || !('guild' in channel)) {
    return null
  }

  return channel
}

export async function resolveMember(
  interaction: ButtonInteraction,
  logger: Logger,
): Promise<GuildMember | null> {
  const member = interaction.member

  if (member && 'voice' in member) {
    return member
  }

  const guild = interaction.guild

  if (!guild) {
    return null
  }

  try {
    return await guild.members.fetch(interaction.user.id)
  } catch (error) {
    logger.warn('discord.member_fetch_failed', { error: errorMessage(error) })

    return null
  }
}
