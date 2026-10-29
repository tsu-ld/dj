import type { ButtonInteraction, GuildMember, GuildTextBasedChannel, Interaction, InteractionReplyOptions } from 'discord.js'
import type { CommandBus, CommandContext, CommandUi } from '../commands/spec.ts'
import type { Logger } from '../core/logger.ts'
import type { MusicPort, QueueView } from '../ports/music.ts'
import type { SettingsPort } from '../ports/settings.ts'
import type { MessageSlot } from './slot.ts'
import { MessageFlags } from 'discord.js'
import { MESSAGES } from '../messages.ts'
import { clearConfirmation, queueMessage } from './views.ts'

const NOW_PLAYING_ACTIONS = new Set(['toggle', 'skip', 'radio', 'shuffle', 'clear', 'queue'])

export interface InteractionHandlerDeps {
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
      await reportFailure(interaction)
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

  const name = interaction.customId.slice('np:'.length)

  // clear is destructive and irreversible: ask before stopping the music
  if (name === 'clear') {
    await interaction.reply(clearConfirmation())

    return
  }

  // ack before acting: playback actions can exceed the 3s window
  await interaction.deferUpdate()

  if (!NOW_PLAYING_ACTIONS.has(name))
    return

  const channel = textChannelOf(interaction)
  const member = await resolveMember(interaction)

  if (!channel || !member) {
    await reportFailure(interaction)

    return
  }

  await deps.bus.run(name, {}, interactionContext(deps, interaction, guildId, member, channel, view))
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
  const member = await resolveMember(interaction)

  if (!channel || !member) {
    await interaction.editReply({ content: MESSAGES.genericError, components: [] })

    return
  }

  const outcome = await deps.bus.run('clear', {}, interactionContext(deps, interaction, guildId, member, channel, view))

  if (outcome.kind === 'failed') {
    // The bus already surfaced the generic error; only close the prompt.
    await interaction.editReply({ components: [] })

    return
  }

  await interaction.editReply({
    content: outcome.kind === 'ok' ? '✅' : outcome.message,
    components: [],
  })
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
    await interaction.message.edit({ content: MESSAGES.nothingPlaying, embeds: [], components: [] })

    return
  }

  const targetPage = direction === 'prev' ? page - 1 : page + 1

  await interaction.message.edit(queueMessage(view, targetPage))
}

function interactionContext(
  deps: InteractionHandlerDeps,
  interaction: ButtonInteraction,
  guildId: string,
  member: GuildMember,
  channel: GuildTextBasedChannel,
  view: QueueView,
): CommandContext {
  const ui: CommandUi = {
    reply: async (text) => {
      await interaction.followUp({ content: text, flags: MessageFlags.Ephemeral })
    },
    error: async (message) => {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral })
    },
    // The interaction is already deferred; the card edit is the feedback.
    ack: async () => {},
    showQueue: async (queueView) => {
      await deps.slot.showQueue(queueView, channel)
    },
  }

  return {
    guildId,
    member,
    voiceChannel: member.voice.channel,
    textChannel: channel,
    message: null,
    settings: deps.settings.get(guildId),
    queue: view,
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

async function resolveMember(interaction: ButtonInteraction): Promise<GuildMember | null> {
  const member = interaction.member

  if (member && 'voice' in member)
    return member

  const guild = interaction.guild

  if (!guild)
    return null

  try {
    return await guild.members.fetch(interaction.user.id)
  }
  catch {
    return null
  }
}

async function reportFailure(interaction: ButtonInteraction): Promise<void> {
  const payload: InteractionReplyOptions = { content: MESSAGES.genericError, flags: MessageFlags.Ephemeral }

  try {
    await interaction.followUp(payload)
  }
  catch {
    await interaction.reply(payload).catch(() => {})
  }
}
