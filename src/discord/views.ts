import type { MessageActionRowComponentBuilder, MessageMentionOptions } from 'discord.js'
import type { QueueView, Track } from '../ports/music.ts'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from 'discord.js'
import { QUEUE_PAGE_SIZE } from '../limits.ts'
import { MESSAGES } from '../messages.ts'
import { clock, linkedTitle, PAUSED_ACCENT, PLAYING_ACCENT, queueLine, statusLine, thumbnailUrl, totalDuration, upcomingText } from './card-format.ts'

export interface ViewMessage {
  readonly components: readonly ContainerBuilder[]
  readonly flags: typeof MessageFlags.IsComponentsV2
  readonly allowedMentions: MessageMentionOptions
}

const NO_MENTIONS: MessageMentionOptions = { parse: [] }

function row(...buttons: ButtonBuilder[]): ActionRowBuilder<MessageActionRowComponentBuilder> {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttons)
}

function button(label: string, customId: string, emoji: string, style = ButtonStyle.Secondary): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style)
}

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content)
}

function separator(): SeparatorBuilder {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
}

const PROGRESS_SEGMENTS = 12
// Discord allows at most five buttons in a row.
const TIMELINE_POINTS = 5
const CUSTOM_ID_MAX = 100

interface Position {
  readonly elapsed: number
  readonly total: number
}

function positionOf(track: Track, elapsedMs: number | null): Position | null {
  const total = Math.floor(track.durationSeconds)

  if (elapsedMs === null || track.isLive || !Number.isFinite(total) || total <= 0)
    return null

  return { elapsed: Math.min(Math.max(Math.floor(elapsedMs / 1000), 0), total), total }
}

function progressLine({ elapsed, total }: Position): string {
  const filled = Math.round((elapsed / total) * PROGRESS_SEGMENTS)

  return `${'▰'.repeat(filled)}${'▱'.repeat(PROGRESS_SEGMENTS - filled)} \`${clock(elapsed)} / ${clock(total)}\``
}

// Discord rejects the whole card over a repeated or overlong custom id.
function timelineRow(track: Track, { elapsed, total }: Position, paused: boolean): ActionRowBuilder<MessageActionRowComponentBuilder> | null {
  const longestId = `np:seek:${total}:${track.id}`

  if (total < TIMELINE_POINTS || longestId.length > CUSTOM_ID_MAX)
    return null

  const points = Array.from({ length: TIMELINE_POINTS }, (_, index) => Math.floor((total * index) / TIMELINE_POINTS))
  const current = points.findLastIndex(seconds => seconds <= elapsed)

  return row(...points.map((seconds, index) => new ButtonBuilder()
    .setCustomId(`np:seek:${seconds}:${track.id}`)
    .setLabel(clock(seconds))
    .setStyle(index === current ? ButtonStyle.Primary : ButtonStyle.Secondary)
    .setDisabled(paused)))
}

export function nowPlayingMessage(view: QueueView, elapsedMs: number | null = null): ViewMessage | null {
  const track = view.current

  if (!track)
    return null

  const container = new ContainerBuilder().setAccentColor(view.paused ? PAUSED_ACCENT : PLAYING_ACCENT)
  const position = positionOf(track, elapsedMs)
  const header = `## ${linkedTitle(track)}\n${statusLine(track, view)}${position === null ? '' : `\n${progressLine(position)}`}`
  const thumbnail = thumbnailUrl(track)

  if (thumbnail === null) {
    container.addTextDisplayComponents(text(header))
  }
  else {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(header))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail).setDescription('Album art')),
    )
  }

  const timeline = position === null ? null : timelineRow(track, position, view.paused)

  if (timeline !== null)
    container.addActionRowComponents(timeline)

  const upcoming = upcomingText(view)

  if (upcoming !== null) {
    container
      .addSeparatorComponents(separator())
      .addTextDisplayComponents(text(upcoming))
  }

  container
    .addSeparatorComponents(separator())
    .addActionRowComponents(
      row(
        button(view.paused ? 'Resume' : 'Pause', 'np:toggle', view.paused ? '▶️' : '⏸️'),
        button('Skip', 'np:skip', '⏭️'),
        button('Shuffle', 'np:shuffle', '🔀'),
      ),
    )
    .addActionRowComponents(
      row(
        button('Radio', 'np:radio', '📻', view.radio ? ButtonStyle.Success : ButtonStyle.Secondary),
        button('Queue', 'np:queue', '📋'),
        button('Leave', 'np:clear', '🚪', ButtonStyle.Danger),
      ),
    )

  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS }
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
    .map((track, index) => {
      const position = start + index + 1
      const current = start + index === 0 && view.current !== null
      const marker = current ? `${view.paused ? '⏸' : '▶'} ` : ''

      return queueLine(track, position, marker)
    })
  const duration = totalDuration(songs)
  const meta = total === 0
    ? 'Nothing queued yet.\n-# Ask me for a song to get started.'
    : `-# ${total} song${total === 1 ? '' : 's'}${duration === null ? '' : ` · ${duration}`}${pageCount > 1 ? ` · Page ${page} of ${pageCount}` : ''}`
  const container = new ContainerBuilder()
    .setAccentColor(view.paused ? PAUSED_ACCENT : PLAYING_ACCENT)
    .addTextDisplayComponents(text(`## Queue\n${meta}`))

  if (total > 0)
    container.addSeparatorComponents(separator()).addTextDisplayComponents(text(lines.join('\n')))

  if (pageCount > 1) {
    container
      .addSeparatorComponents(separator())
      .addActionRowComponents(
        row(
          button('Previous', `nq:prev:${page}`, '⬅️').setDisabled(page <= 1),
          button('Next', `nq:next:${page}`, '➡️').setDisabled(page >= pageCount),
        ),
      )
  }

  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS }
}

export function noticeMessage(content: string): ViewMessage {
  return {
    components: [new ContainerBuilder().addTextDisplayComponents(text(content))],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: NO_MENTIONS,
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
        new ButtonBuilder().setCustomId('nc:clear:yes').setLabel('Leave').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('nc:clear:no').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  }
}
