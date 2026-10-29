import type { MessageActionRowComponentBuilder } from 'discord.js'
import type { QueueView, Track } from '../ports/music.ts'
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js'
import { QUEUE_PAGE_SIZE } from '../limits.ts'
import { MESSAGES } from '../messages.ts'

export interface ViewMessage {
  readonly embeds: readonly EmbedBuilder[]
  readonly components: readonly ActionRowBuilder<MessageActionRowComponentBuilder>[]
}

function row(...buttons: ButtonBuilder[]): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttons)
}

function displayName(track: Track): string {
  return track.title.trim() || track.url || 'Unknown song'
}

export function formatDuration(track: Track): string {
  if (track.isLive)
    return 'Live'

  if (!Number.isFinite(track.durationSeconds) || track.durationSeconds <= 0)
    return 'Unknown'

  const total = Math.floor(track.durationSeconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  if (hours > 0)
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function nowPlayingMessage(view: QueueView): ViewMessage | null {
  const track = view.current

  if (!track)
    return null

  const embed = new EmbedBuilder()
    .setTitle(displayName(track))
    .setURL(track.url || null)
    .setThumbnail(track.thumbnail)
    .addFields(
      { name: 'Duration', value: formatDuration(track), inline: true },
      { name: 'Requested by', value: track.requestedBy ?? 'Unknown', inline: true },
      { name: 'Status', value: view.paused ? 'Paused' : 'Playing', inline: true },
    )
    .setFooter({ text: `${Math.max(view.size - 1, 0)} in queue` })

  return {
    embeds: [embed],
    components: [
      row(
        new ButtonBuilder().setCustomId('np:toggle').setLabel(view.paused ? 'Resume' : 'Pause').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('np:skip').setLabel('Skip').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('np:radio').setLabel('Radio').setStyle(view.radio ? ButtonStyle.Success : ButtonStyle.Secondary),
      ),
      row(
        new ButtonBuilder().setCustomId('np:shuffle').setLabel('Shuffle').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('np:clear').setLabel('Clear').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('np:queue').setLabel('Queue').setStyle(ButtonStyle.Secondary),
      ),
    ],
  }
}

function songsOf(view: QueueView): Track[] {
  return view.current ? [view.current, ...view.upcoming] : [...view.upcoming]
}

export function queueMessage(view: QueueView, requestedPage: number): ViewMessage {
  const songs = songsOf(view)
  const total = songs.length
  const pageCount = Math.max(Math.ceil(total / QUEUE_PAGE_SIZE), 1)
  const page = Math.min(Math.max(requestedPage, 1), pageCount)
  const start = (page - 1) * QUEUE_PAGE_SIZE
  const lines = songs
    .slice(start, start + QUEUE_PAGE_SIZE)
    .map((track, index) => `${start + index + 1}. ${displayName(track)}`)

  const embed = new EmbedBuilder()
    .setTitle(`Queue (${total} songs)`)
    .setDescription(lines.join('\n') || 'Empty')
    .setFooter({ text: `Page ${page} of ${pageCount}` })

  return {
    embeds: [embed],
    components: [
      row(
        new ButtonBuilder()
          .setCustomId(`nq:prev:${page}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page <= 1),
        new ButtonBuilder()
          .setCustomId(`nq:next:${page}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= pageCount),
      ),
    ],
  }
}

export interface ClearConfirmation {
  readonly content: string
  readonly components: readonly ActionRowBuilder<MessageActionRowComponentBuilder>[]
  readonly flags: typeof MessageFlags.Ephemeral
}

export function clearConfirmation(): ClearConfirmation {
  return {
    content: MESSAGES.clearConfirm,
    components: [
      row(
        new ButtonBuilder().setCustomId('nc:clear:yes').setLabel('Clear').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('nc:clear:no').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  }
}
