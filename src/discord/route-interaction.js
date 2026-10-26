import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, MessageFlags } from 'discord.js'
import { ActionError } from '../actions/action.js'
import { getAction } from '../actions/index.js'
import { MESSAGES } from '../messages/en.js'
import { queueView } from '../music/now-playing.js'
import { player } from '../music/player.js'
import { client } from './client.js'

const NOW_PLAYING_ACTIONS = new Set(['toggle', 'skip', 'radio', 'shuffle', 'clear', 'queue'])

export function setupInteractionRouter() {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (!interaction.isButton())
        return

      if (interaction.customId.startsWith('np:')) {
        await handleNowPlayingButton(interaction)

        return
      }

      if (interaction.customId.startsWith('nc:')) {
        await handleClearConfirmation(interaction)

        return
      }

      if (interaction.customId.startsWith('nq:'))
        await handleQueuePageButton(interaction)
    }
    catch (error) {
      console.error('[Discord] Interaction error:', error)
    }
  })
}

async function handleNowPlayingButton(interaction) {
  const guildId = interaction.guildId

  if (!guildId)
    return

  const queue = player.getQueue(guildId)

  if (!queue) {
    await interaction.reply({ content: MESSAGES.nothingPlaying, flags: MessageFlags.Ephemeral })

    return
  }

  const name = interaction.customId.slice('np:'.length)

  // clear is destructive and irreversible: ask before stopping the music
  if (name === 'clear') {
    await interaction.reply(clearConfirmation())

    return
  }

  const action = NOW_PLAYING_ACTIONS.has(name) ? getAction(name) : null

  // ack before acting: distube actions can exceed the 3s window while downloading audio
  await interaction.deferUpdate()

  if (!action)
    return

  try {
    await action.run({}, {
      guildId,
      queue,
      textChannel: queue.textChannel,
      member: interaction.member,
    })
  }
  catch (error) {
    if (!(error instanceof ActionError))
      throw error

    await interaction.followUp({ content: error.message, flags: MessageFlags.Ephemeral })
  }
}

function clearConfirmation() {
  return {
    content: MESSAGES.clearConfirm,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('nc:clear:yes').setLabel('Clear').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('nc:clear:no').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  }
}

async function handleClearConfirmation(interaction) {
  const guildId = interaction.guildId

  if (!guildId)
    return

  const confirmed = interaction.customId === 'nc:clear:yes'
  const cancelled = interaction.customId === 'nc:clear:no'

  await interaction.deferUpdate()

  if (!confirmed && !cancelled)
    return

  if (!confirmed) {
    await interaction.editReply({ content: MESSAGES.clearCancelled, components: [] })

    return
  }

  const queue = player.getQueue(guildId)

  if (!queue) {
    await interaction.editReply({ content: MESSAGES.nothingPlaying, components: [] })

    return
  }

  await getAction('clear').run({}, {
    guildId,
    queue,
    textChannel: queue.textChannel,
    member: interaction.member,
  })
  await interaction.editReply({ content: '✅', components: [] })
}

async function handleQueuePageButton(interaction) {
  const guildId = interaction.guildId

  if (!guildId)
    return

  const [direction, rawPage] = interaction.customId.slice('nq:'.length).split(':')
  const page = Number.parseInt(rawPage, 10)

  if (!Number.isInteger(page)) {
    await interaction.deferUpdate()

    return
  }

  const queue = player.getQueue(guildId)

  if (!queue) {
    await updateQueueMessage(interaction, {
      content: MESSAGES.nothingPlaying,
      embeds: [],
      components: [],
    })

    return
  }

  const targetPage = direction === 'prev' ? page - 1 : page + 1
  const view = queueView(queue, targetPage)

  await updateQueueMessage(interaction, {
    embeds: [view.embed],
    components: [view.row],
  })
}

async function updateQueueMessage(interaction, payload) {
  await interaction.deferUpdate()
  await interaction.message.edit(payload)
}
