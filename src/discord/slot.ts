import type { GuildTextBasedChannel, Message } from 'discord.js'
import type { Logger } from '../core/logger.ts'
import type { PlaybackStatus, QueueView } from '../ports/music.ts'
import { keyedQueue } from '../core/async.ts'
import { errorMessage } from '../core/errors.ts'
import { NOW_PLAYING_REPOST_MS } from '../limits.ts'
import { isDeletedMessage, isPastEditWindow, progressTimers } from './progress.ts'
import { nowPlayingMessage, queueMessage } from './views.ts'

export interface SlotPayload {
  readonly guildId: string
  readonly view: QueueView
  readonly textChannel: GuildTextBasedChannel | null
}

export interface MessageSlot {
  update: (payload: SlotPayload) => void
  queueChanged: (payload: SlotPayload) => void
  playlistQueued: (payload: SlotPayload) => void
  queueCleared: (payload: { readonly guildId: string }) => void
  showQueue: (view: QueueView, textChannel: GuildTextBasedChannel) => Promise<void>
  repost: (payload: SlotPayload) => void
  dispose: () => void
}

interface Card {
  readonly message: Message
  readonly channelId: string
}

interface ViewState {
  readonly view: QueueView
  readonly textChannel: GuildTextBasedChannel
}

// The now-playing and queue cards are the bot's only long-lived messages. This
// object owns their ids, their writes and their timers per guild: music events
// and the message handler only hand it a snapshot.
export function messageSlot(deps: {
  logger: Logger
  playback?: (guildId: string) => PlaybackStatus | null
}): MessageSlot {
  const nowPlaying = new Map<string, Card>()
  const queueCards = new Map<string, Message>()
  const latest = new Map<string, ViewState>()
  const repostTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const writes = keyedQueue()
  let disposed = false

  async function deleteCard(message: Message, label: string): Promise<void> {
    if (!message.deletable)
      return

    try {
      await message.delete()
    }
    catch (error) {
      deps.logger.error('discord.card_delete_failed', error, { label })
    }
  }

  async function deleteNowPlaying(guildId: string): Promise<void> {
    const card = nowPlaying.get(guildId)

    nowPlaying.delete(guildId)

    if (card)
      await deleteCard(card.message, 'now playing message')
  }

  async function deleteQueueCard(guildId: string): Promise<void> {
    const message = queueCards.get(guildId)

    queueCards.delete(guildId)

    if (message)
      await deleteCard(message, 'queue message')
  }

  // Assumes the guild's write lock is held.
  async function writeNowPlaying(guildId: string): Promise<void> {
    const state = latest.get(guildId)

    if (!state)
      return

    const status = deps.playback?.(guildId) ?? null
    const payload = nowPlayingMessage(state.view, status === null ? null : status.playbackDurationMs)

    if (!payload)
      return

    // a long run replaces its card before Discord stops accepting edits to it
    if (isPastEditWindow(nowPlaying.get(guildId)?.message, Date.now()))
      await deleteNowPlaying(guildId)

    const card = nowPlaying.get(guildId)

    if (card && card.channelId === state.textChannel.id) {
      try {
        await card.message.edit(payload)

        return
      }
      catch (error) {
        deps.logger.error('discord.now_playing_edit_failed', error)

        if (nowPlaying.get(guildId) === card)
          nowPlaying.delete(guildId)
      }
    }

    const sent = await state.textChannel.send(payload)

    nowPlaying.set(guildId, { message: sent, channelId: state.textChannel.id })
  }

  // Write lock held. A tick only edits the card where it is, never posts one.
  async function repaintNowPlaying(guildId: string): Promise<void> {
    const card = nowPlaying.get(guildId)
    const state = latest.get(guildId)
    const status = deps.playback?.(guildId) ?? null
    const payload = state && status ? nowPlayingMessage(state.view, status.playbackDurationMs) : null

    if (!card || !payload)
      return

    try {
      await card.message.edit(payload)
    }
    catch (error) {
      deps.logger.warn('discord.progress_edit_failed', { error: errorMessage(error) })

      if (isDeletedMessage(error) && nowPlaying.get(guildId) === card)
        nowPlaying.delete(guildId)
    }
  }

  function clearRepostTimer(guildId: string): void {
    const timer = repostTimers.get(guildId)

    if (timer) {
      clearTimeout(timer)
      repostTimers.delete(guildId)
    }
  }

  // The message handler schedules this after a user message, and showing the
  // queue schedules it too, so the card falls back to the bottom; the timer's
  // own send never schedules another.
  function scheduleRepost(guildId: string): void {
    if (disposed)
      return

    clearRepostTimer(guildId)
    repostTimers.set(guildId, setTimeout(() => {
      repostTimers.delete(guildId)

      void writes.run(guildId, async () => {
        // Only a card that already exists is moved: showing the queue must not
        // invent a now-playing card for a queue that never showed one.
        if (!nowPlaying.has(guildId))
          return

        await deleteNowPlaying(guildId)
        await writeNowPlaying(guildId)
      }).catch(error => deps.logger.error('discord.now_playing_repost_failed', error))
    }, NOW_PLAYING_REPOST_MS))
  }

  // Assumes the guild's write lock is held. The queue order just changed, so the
  // card goes back to page 1, where the playing song is.
  async function redrawQueueCard(guildId: string): Promise<void> {
    const message = queueCards.get(guildId)
    const state = latest.get(guildId)

    if (!message || !state)
      return

    try {
      await message.edit(queueMessage(state.view, 1))
    }
    catch (error) {
      deps.logger.error('discord.queue_card_edit_failed', error)

      if (queueCards.get(guildId) === message)
        queueCards.delete(guildId)
    }
  }

  const progress = progressTimers({
    enabled: deps.playback !== undefined,
    playing: guildId => deps.playback?.(guildId)?.state === 'playing',
    repaint: (guildId) => {
      void writes.run(guildId, async () => repaintNowPlaying(guildId))
        .catch(error => deps.logger.error('discord.progress_failed', error))
    },
  })

  function update(payload: SlotPayload): void {
    const { guildId, view, textChannel } = payload

    if (!textChannel)
      return

    latest.set(guildId, { view, textChannel })
    progress.sync(guildId, view)

    void writes.run(guildId, async () => {
      await redrawQueueCard(guildId)
      await writeNowPlaying(guildId)
    }).catch(error => deps.logger.error('discord.now_playing_failed', error))
  }

  // One song added: only a visible queue card changes.
  function queueChanged({ guildId, view }: SlotPayload): void {
    const state = latest.get(guildId)

    if (!state || !queueCards.has(guildId))
      return

    latest.set(guildId, { view, textChannel: state.textChannel })
    void writes.run(guildId, async () => redrawQueueCard(guildId))
      .catch(error => deps.logger.error('discord.queue_card_failed', error))
  }

  // A fresh queue card replaces the old one, then the now-playing card moves below it.
  async function postQueueCard(guildId: string, view: QueueView, textChannel: GuildTextBasedChannel): Promise<void> {
    latest.set(guildId, { view, textChannel })

    await writes.run(guildId, async () => {
      await deleteQueueCard(guildId)

      const sent = await textChannel.send(queueMessage(view, 1))

      queueCards.set(guildId, sent)
    })

    scheduleRepost(guildId)
  }

  function playlistQueued({ guildId, view, textChannel }: SlotPayload): void {
    if (textChannel)
      void postQueueCard(guildId, view, textChannel).catch(error => deps.logger.error('discord.queue_card_failed', error))
  }

  async function showQueue(view: QueueView, textChannel: GuildTextBasedChannel): Promise<void> {
    await postQueueCard(textChannel.guild.id, view, textChannel)
  }

  function repost(payload: SlotPayload): void {
    const { guildId, view, textChannel } = payload
    const card = nowPlaying.get(guildId)

    if (!textChannel || disposed || !card || card.channelId !== textChannel.id)
      return

    latest.set(guildId, { view, textChannel })
    scheduleRepost(guildId)
  }

  function queueCleared({ guildId }: { readonly guildId: string }): void {
    clearRepostTimer(guildId)
    progress.stop(guildId)
    latest.delete(guildId)

    void writes.run(guildId, async () => {
      await deleteNowPlaying(guildId)
      await deleteQueueCard(guildId)
    }).catch(error => deps.logger.error('discord.clear_cards_failed', error))
  }

  function dispose(): void {
    disposed = true

    for (const timer of repostTimers.values())
      clearTimeout(timer)

    progress.dispose()
    repostTimers.clear()
    latest.clear()
  }

  return { update, queueChanged, playlistQueued, queueCleared, showQueue, repost, dispose }
}
