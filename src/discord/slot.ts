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

export function messageSlot(deps: {
  logger: Logger
  playback: (guildId: string) => PlaybackStatus | null
}): MessageSlot {
  const nowPlaying = new Map<string, Card>()
  const queueCards = new Map<string, Message>()
  const latest = new Map<string, ViewState>()
  const repostTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const writes = keyedQueue()
  let disposed = false

  function writeInOrder(guildId: string, failure: string, write: () => Promise<void>): void {
    void writes.run(guildId, write).catch((error: unknown) => deps.logger.error(failure, error))
  }

  async function deleteCard(message: Message, label: string): Promise<void> {
    if (!message.deletable) {
      return
    }

    try {
      await message.delete()
    } catch (error) {
      deps.logger.error('discord.card_delete_failed', error, { label })
    }
  }

  async function deleteNowPlaying(guildId: string): Promise<void> {
    const card = nowPlaying.get(guildId)

    nowPlaying.delete(guildId)

    if (card) {
      await deleteCard(card.message, 'now playing message')
    }
  }

  async function deleteQueueCard(guildId: string): Promise<void> {
    const message = queueCards.get(guildId)

    queueCards.delete(guildId)

    if (message) {
      await deleteCard(message, 'queue message')
    }
  }

  async function writeNowPlaying(guildId: string): Promise<void> {
    const state = latest.get(guildId)

    if (!state) {
      return
    }

    const status = deps.playback(guildId)
    const payload = nowPlayingMessage(
      state.view,
      status === null ? null : status.playbackDurationMs,
    )

    if (!payload) {
      return
    }

    if (isPastEditWindow(nowPlaying.get(guildId)?.message, Date.now())) {
      await deleteNowPlaying(guildId)
    }

    const card = nowPlaying.get(guildId)

    if (card && card.channelId === state.textChannel.id) {
      try {
        await card.message.edit(payload)

        return
      } catch (error) {
        deps.logger.error('discord.now_playing_edit_failed', error)

        if (nowPlaying.get(guildId) === card) {
          nowPlaying.delete(guildId)
        }
      }
    }

    const sent = await state.textChannel.send(payload)

    nowPlaying.set(guildId, { message: sent, channelId: state.textChannel.id })
  }

  async function repaintNowPlaying(guildId: string): Promise<void> {
    const card = nowPlaying.get(guildId)
    const state = latest.get(guildId)
    const status = deps.playback(guildId)
    const payload =
      state && status ? nowPlayingMessage(state.view, status.playbackDurationMs) : null

    if (!card || !payload) {
      return
    }

    try {
      await card.message.edit(payload)
    } catch (error) {
      deps.logger.warn('discord.progress_edit_failed', { error: errorMessage(error) })

      if (isDeletedMessage(error) && nowPlaying.get(guildId) === card) {
        nowPlaying.delete(guildId)
      }
    }
  }

  function clearRepostTimer(guildId: string): void {
    const timer = repostTimers.get(guildId)

    if (timer) {
      clearTimeout(timer)
      repostTimers.delete(guildId)
    }
  }

  function scheduleRepost(guildId: string): void {
    if (disposed) {
      return
    }

    clearRepostTimer(guildId)
    repostTimers.set(
      guildId,
      setTimeout(() => {
        repostTimers.delete(guildId)

        writeInOrder(guildId, 'discord.now_playing_repost_failed', async () => {
          if (!nowPlaying.has(guildId)) {
            return
          }

          await deleteNowPlaying(guildId)
          await writeNowPlaying(guildId)
        })
      }, NOW_PLAYING_REPOST_MS),
    )
  }

  async function redrawQueueCard(guildId: string): Promise<void> {
    const message = queueCards.get(guildId)
    const state = latest.get(guildId)

    if (!message || !state) {
      return
    }

    try {
      await message.edit(queueMessage(state.view, 1))
    } catch (error) {
      deps.logger.error('discord.queue_card_edit_failed', error)

      if (queueCards.get(guildId) === message) {
        queueCards.delete(guildId)
      }
    }
  }

  const progress = progressTimers({
    playing: (guildId) => deps.playback(guildId)?.state === 'playing',
    repaint: (guildId) => {
      writeInOrder(guildId, 'discord.progress_failed', async () => repaintNowPlaying(guildId))
    },
  })

  function update(payload: SlotPayload): void {
    const { guildId, view, textChannel } = payload

    if (!textChannel) {
      return
    }

    latest.set(guildId, { view, textChannel })
    progress.sync(guildId, view)

    writeInOrder(guildId, 'discord.now_playing_failed', async () => {
      await redrawQueueCard(guildId)
      await writeNowPlaying(guildId)
    })
  }

  function queueChanged({ guildId, view }: SlotPayload): void {
    const state = latest.get(guildId)

    if (!state || !queueCards.has(guildId)) {
      return
    }

    latest.set(guildId, { view, textChannel: state.textChannel })
    writeInOrder(guildId, 'discord.queue_card_failed', async () => redrawQueueCard(guildId))
  }

  async function postQueueCard(
    guildId: string,
    view: QueueView,
    textChannel: GuildTextBasedChannel,
  ): Promise<void> {
    latest.set(guildId, { view, textChannel })

    await writes.run(guildId, async () => {
      await deleteQueueCard(guildId)

      const sent = await textChannel.send(queueMessage(view, 1))

      queueCards.set(guildId, sent)
    })

    scheduleRepost(guildId)
  }

  function playlistQueued({ guildId, view, textChannel }: SlotPayload): void {
    if (textChannel) {
      void postQueueCard(guildId, view, textChannel).catch((error: unknown) =>
        deps.logger.error('discord.queue_card_failed', error),
      )
    }
  }

  async function showQueue(view: QueueView, textChannel: GuildTextBasedChannel): Promise<void> {
    await postQueueCard(textChannel.guild.id, view, textChannel)
  }

  function repost(payload: SlotPayload): void {
    const { guildId, view, textChannel } = payload
    const card = nowPlaying.get(guildId)

    if (!textChannel || !card || card.channelId !== textChannel.id) {
      return
    }

    latest.set(guildId, { view, textChannel })
    scheduleRepost(guildId)
  }

  function queueCleared({ guildId }: { readonly guildId: string }): void {
    clearRepostTimer(guildId)
    progress.stop(guildId)
    latest.delete(guildId)

    writeInOrder(guildId, 'discord.clear_cards_failed', async () => {
      await deleteNowPlaying(guildId)
      await deleteQueueCard(guildId)
    })
  }

  function dispose(): void {
    disposed = true

    for (const timer of repostTimers.values()) {
      clearTimeout(timer)
    }

    progress.dispose()
    repostTimers.clear()
    latest.clear()
  }

  return { update, queueChanged, playlistQueued, queueCleared, showQueue, repost, dispose }
}
