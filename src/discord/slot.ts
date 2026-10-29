import type { GuildTextBasedChannel, Message } from 'discord.js'
import type { Logger } from '../core/logger.ts'
import type { QueueView } from '../ports/music.ts'
import { keyedQueue } from '../core/async.ts'
import { NOW_PLAYING_REPOST_MS } from '../limits.ts'
import { nowPlayingMessage, queueMessage } from './views.ts'

export interface SlotPayload {
  readonly guildId: string
  readonly view: QueueView
  readonly textChannel: GuildTextBasedChannel | null
}

export interface MessageSlot {
  trackStarted: (payload: SlotPayload) => void
  stateChanged: (payload: SlotPayload) => void
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
export function messageSlot(deps: { logger: Logger }): MessageSlot {
  const nowPlaying = new Map<string, Card>()
  const queueCards = new Map<string, Message>()
  const latest = new Map<string, ViewState>()
  const repostTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const writes = keyedQueue()
  let disposed = false

  function report(event: string, error: unknown, fields?: Record<string, unknown>): void {
    deps.logger.error(event, error, fields)
  }

  async function deleteCard(message: Message, label: string): Promise<void> {
    if (!message.deletable)
      return

    try {
      await message.delete()
    }
    catch (error) {
      report('discord.card_delete_failed', error, { label })
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

    const payload = nowPlayingMessage(state.view)

    if (!payload)
      return

    const card = nowPlaying.get(guildId)

    if (card && card.channelId === state.textChannel.id) {
      try {
        await card.message.edit(payload)

        return
      }
      catch (error) {
        report('discord.now_playing_edit_failed', error)

        if (nowPlaying.get(guildId) === card)
          nowPlaying.delete(guildId)
      }
    }

    const sent = await state.textChannel.send(payload)

    nowPlaying.set(guildId, { message: sent, channelId: state.textChannel.id })
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
      }).catch(error => report('discord.now_playing_repost_failed', error))
    }, NOW_PLAYING_REPOST_MS))
  }

  function update(payload: SlotPayload): void {
    const { guildId, view, textChannel } = payload

    if (!textChannel)
      return

    latest.set(guildId, { view, textChannel })

    void writes.run(guildId, async () => writeNowPlaying(guildId))
      .catch(error => report('discord.now_playing_failed', error))
  }

  function playlistQueued(payload: SlotPayload): void {
    const { guildId, view, textChannel } = payload

    if (!textChannel)
      return

    latest.set(guildId, { view, textChannel })

    void writes.run(guildId, async () => {
      await deleteQueueCard(guildId)

      const sent = await textChannel.send(queueMessage(view, 1))

      queueCards.set(guildId, sent)
    }).then(() => scheduleRepost(guildId)).catch(error => report('discord.queue_card_failed', error))
  }

  async function showQueue(view: QueueView, textChannel: GuildTextBasedChannel): Promise<void> {
    const guildId = textChannel.guild.id

    latest.set(guildId, { view, textChannel })

    await writes.run(guildId, async () => {
      await deleteQueueCard(guildId)

      const sent = await textChannel.send(queueMessage(view, 1))

      queueCards.set(guildId, sent)
    })

    scheduleRepost(guildId)
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
    latest.delete(guildId)

    void writes.run(guildId, async () => {
      await deleteNowPlaying(guildId)
      await deleteQueueCard(guildId)
    }).catch(error => report('discord.clear_cards_failed', error))
  }

  function dispose(): void {
    disposed = true

    for (const timer of repostTimers.values())
      clearTimeout(timer)

    repostTimers.clear()
    latest.clear()
  }

  return { trackStarted: update, stateChanged: update, playlistQueued, queueCleared, showQueue, repost, dispose }
}
