import type { ButtonInteraction, GuildMember, GuildTextBasedChannel, Interaction, InteractionReplyOptions, Message } from 'discord.js'
import type { CommandBus, CommandContext, CommandUi } from '../commands/spec.ts'
import type { Logger } from '../core/logger.ts'
import type { MusicPort } from '../ports/music.ts'
import type { SettingsPort } from '../ports/settings.ts'
import type { MessageSlot } from './slot.ts'
import type { ViewMessage } from './views.ts'
import { MessageFlags } from 'discord.js'
import { errorMessage } from '../core/errors.ts'
import { MESSAGES } from '../messages.ts'
import { clearConfirmation, noticeMessage, queueMessage } from './views.ts'

const NOW_PLAYING_ACTIONS = new Set(['toggle', 'skip', 'radio', 'shuffle', 'queue', 'seek'])

interface InteractionHandlerDeps {
  readonly bus: CommandBus
  readonly music: MusicPort
  readonly settings: SettingsPort
  readonly slot: MessageSlot
  readonly logger: Logger
}

export function interactionHandler(deps: InteractionHandlerDeps): (interaction: Interaction) => Promise<void> {
  return async (interaction) => {
    if (!interaction.isButton())
      return

    try {
      if (interaction.customId.startsWith('np:')) {
        await handleNowPlaying(deps, interaction)

        return
      }

      if (interaction.customId.startsWith('nc:')) {
        await handleClearConfirmation(deps, interaction)

        return
      }

      if (interaction.customId.startsWith('nq:'))
        await handleQueuePage(deps, interaction)
    }
    catch (error) {
      deps.logger.error('discord.interaction_failed', error)
      await reportFailure(interaction, deps.logger)
    }
  }
}

async function handleNowPlaying(deps: InteractionHandlerDeps, interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.guildId

  if (guildId === null)
    return

  const view = deps.music.view(guildId)

  if (!view) {
    await interaction.reply({ content: MESSAGES.nothingPlaying, flags: MessageFlags.Ephemeral })

    return
  }

  const [name = '', rawSeconds = '', ...songId] = interaction.customId.slice('np:'.length).split(':')

  if (name === 'clear') {
    await interaction.reply(clearConfirmation())

    return
  }

  // Discord drops an interaction not acknowledged within 3 seconds.
  await interaction.deferUpdate()

  if (!NOW_PLAYING_ACTIONS.has(name))
    return

  const channel = textChannelOf(interaction)
  const member = await resolveMember(interaction, deps.logger)

  if (!channel || !member) {
    await reportFailure(interaction, deps.logger)

    return
  }

  const args = name === 'seek' ? { seconds: Number.parseInt(rawSeconds, 10), songId: songId.join(':') } : {}

  await deps.bus.run(name, args, interactionContext(deps, guildId, member, channel, buttonUi(deps, interaction, guildId, channel)))
}

async function handleClearConfirmation(deps: InteractionHandlerDeps, interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.guildId
  const confirmed = interaction.customId === 'nc:clear:yes'
  const cancelled = interaction.customId === 'nc:clear:no'

  if (guildId === null)
    return

  await interaction.deferUpdate()

  if (!confirmed && !cancelled)
    return

  if (!confirmed) {
    await interaction.editReply({ content: MESSAGES.clearCancelled, components: [] })

    return
  }

  const view = deps.music.view(guildId)

  if (!view) {
    await interaction.editReply({ content: MESSAGES.nothingPlaying, components: [] })

    return
  }

  const channel = textChannelOf(interaction)
  const member = await resolveMember(interaction, deps.logger)

  if (!channel || !member) {
    await interaction.editReply({ content: MESSAGES.genericError, components: [] })

    return
  }

  const ui: CommandUi = {
    ...buttonUi(deps, interaction, guildId, channel),
    reply: async (text) => {
      try {
        await interaction.editReply({ content: text, components: [] })
      }
      catch (error) {
        deps.logger.warn('discord.clear_feedback_failed', { error: errorMessage(error) })
      }
    },
  }
  const outcome = await deps.bus.run('clear', {}, interactionContext(deps, guildId, member, channel, ui))

  if (outcome.kind !== 'ok')
    await interaction.editReply({ components: [] })
}

async function editCard(message: Message, payload: ViewMessage): Promise<void> {
  // Discord rejects the edit unless the legacy content and embeds are explicitly cleared.
  await message.edit({ components: payload.components, flags: payload.flags, allowedMentions: payload.allowedMentions, content: null, embeds: [] })
}

async function handleQueuePage(deps: InteractionHandlerDeps, interaction: ButtonInteraction): Promise<void> {
  const guildId = interaction.guildId
  const [direction, rawPage] = interaction.customId.slice('nq:'.length).split(':')
  const page = Number.parseInt(rawPage ?? '', 10)

  if (guildId === null)
    return

  await interaction.deferUpdate()

  if (!Number.isInteger(page))
    return

  const view = deps.music.view(guildId)

  if (!view) {
    await editCard(interaction.message, noticeMessage(MESSAGES.nothingPlaying))

    return
  }

  const targetPage = direction === 'prev' ? page - 1 : page + 1

  await editCard(interaction.message, queueMessage(view, targetPage))
}

function buttonUi(deps: InteractionHandlerDeps, interaction: ButtonInteraction, guildId: string, channel: GuildTextBasedChannel): CommandUi {
  return {
    reply: async (text) => {
      if (deps.music.status(guildId) === null)
        await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral })
    },
    error: async (message) => {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral })
    },
    ack: async () => {},
    showQueue: async (queueView) => {
      await deps.slot.showQueue(queueView, channel)
    },
  }
}

function interactionContext(
  deps: InteractionHandlerDeps,
  guildId: string,
  member: GuildMember,
  channel: GuildTextBasedChannel,
  ui: CommandUi,
): CommandContext {
  return {
    guildId,
    member,
    voiceChannel: member.voice.channel,
    textChannel: channel,
    message: null,
    services: { music: deps.music, settings: deps.settings, logger: deps.logger },
    ui,
  }
}

function textChannelOf(interaction: ButtonInteraction): GuildTextBasedChannel | null {
  const channel = interaction.channel

  if (!channel || !channel.isTextBased() || !('guild' in channel))
    return null

  return channel
}

async function resolveMember(interaction: ButtonInteraction, logger: Logger): Promise<GuildMember | null> {
  const member = interaction.member

  if (member && 'voice' in member)
    return member

  const guild = interaction.guild

  if (!guild)
    return null

  try {
    return await guild.members.fetch(interaction.user.id)
  }
  catch (error) {
    logger.warn('discord.member_fetch_failed', { error: errorMessage(error) })

    return null
  }
}

async function reportFailure(interaction: ButtonInteraction, logger: Logger): Promise<void> {
  const payload: InteractionReplyOptions = { content: MESSAGES.genericError, flags: MessageFlags.Ephemeral }

  try {
    await interaction.followUp(payload)
  }
  catch {
    await interaction.reply(payload).catch((error: unknown) => {
      logger.warn('discord.failure_report_failed', { error: errorMessage(error) })
    })
  }
}
