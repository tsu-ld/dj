import type { Client, VoiceState } from 'discord.js'
import type { Playlist, Queue, Song } from 'distube'
import type { Logger } from '../../core/logger.ts'
import type { BeforeStreamInput, QueueView } from '../../ports/music.ts'
import type { AudioCache } from './cache.ts'
import type { MusicCatalog } from './catalog.ts'
import type { MusicEmitter, PlayCapture } from './types.ts'
import { Events as DiscordEvents } from 'discord.js'
import { Events, isVoiceChannelEmpty } from 'distube'
import { announcesAdd, leavesEmptyChannel, shouldCleanupAfterError } from './queue.ts'

// A Spotify song resolves its YouTube stream first; the line belongs to the
// song the queue is showing, not to the internal search result.
export function currentForStream<TSong extends { stream: { playFromSource?: boolean } }>(
  song: TSong,
  queue: { readonly songs: readonly TSong[] } | null,
): TSong | null {
  const current = queue?.songs[0]

  if (!current)
    return null

  if (current !== song && current.stream.playFromSource !== false)
    return null

  return current
}

export function musicEvents(deps: {
  player: import('distube').DisTube
  client: Client
  catalog: MusicCatalog
  cache: AudioCache
  emitter: MusicEmitter
  plays: Map<string, PlayCapture>
  beforeStream: (input: BeforeStreamInput) => Promise<void>
  forgetStream: (songId: string) => void
  leave: (guildId: string) => void
  viewOf: (queue: Queue) => QueueView
  logger: Logger
}): { detach: Array<() => void>, beforeStreamFor: (song: Song) => Promise<void> } {
  const { player, client, catalog, cache, emitter, plays, beforeStream, forgetStream, leave, viewOf, logger } = deps
  const lastSong = new Map<string, string>()
  const detach: Array<() => void> = []

  function queueForSong(song: Song): Queue | null {
    const guildId = song.member?.guild?.id

    if (guildId !== undefined)
      return player.getQueue(guildId) ?? null

    for (const queue of player.queues.collection.values()) {
      if (queue.songs[0] === song)
        return queue
    }

    return null
  }

  async function beforeStreamFor(song: Song): Promise<void> {
    const queue = queueForSong(song)

    if (!queue)
      return

    const current = currentForStream(song, queue)

    if (!current)
      return

    await beforeStream({ guildId: queue.id, view: viewOf(queue) })
  }

  function onAddSong(queue: Queue, song: Song): void {
    const track = catalog.trackOf(song)

    logger.info('music.song_added', { guildId: queue.id, title: track.title })
    emitter.trackQueued({
      guildId: queue.id,
      track,
      view: viewOf(queue),
      textChannel: queue.textChannel ?? null,
      announce: announcesAdd(plays.get(queue.id), track),
    })
  }

  function onAddList(queue: Queue, playlist: Playlist): void {
    const name = playlist.name ?? playlist.url ?? 'Playlist'
    const count = playlist.songs.length
    const capture = plays.get(queue.id)

    logger.info('music.playlist_added', { guildId: queue.id, name, count })

    emitter.playlistQueued({
      guildId: queue.id,
      name,
      count,
      view: viewOf(queue),
      textChannel: queue.textChannel ?? null,
      announce: capture?.announce === true,
    })
  }

  function onPlaySong(queue: Queue, song: Song): void {
    logger.info('music.playing', { guildId: queue.id, title: song.name ?? song.id })
    lastSong.set(queue.id, song.id)
    emitter.trackStarted({
      guildId: queue.id,
      track: catalog.trackOf(song),
      view: viewOf(queue),
      textChannel: queue.textChannel ?? null,
    })
    cache.prefetch(queue.songs[1], queue.id)
  }

  function onFinish(queue: Queue): void {
    logger.info('music.queue_finished', { guildId: queue.id })
    emitter.queueEnded({ guildId: queue.id })
    leave(queue.id)
  }

  function onNoRelated(queue: Queue): void {
    logger.info('music.no_related', { guildId: queue.id })
    emitter.queueEnded({ guildId: queue.id })
    leave(queue.id)
  }

  function onDisconnect(queue: Queue): void {
    emitter.disconnected({ guildId: queue.id })
  }

  function onError(error: Error, queue: Queue | undefined): void {
    logger.error('music.playback_error', error, { guildId: queue?.id })

    if (!queue)
      return

    // A remembered progressive url can answer 403 after a few plays. Forget it
    // for this song so the next request resolves a fresh one instead of failing
    // on the same dead url for the rest of its lifetime.
    const failed = lastSong.get(queue.id)

    if (failed !== undefined)
      forgetStream(failed)

    const cleanup = shouldCleanupAfterError(queue, player.getQueue(queue.id))

    emitter.playbackError({ guildId: queue.id, textChannel: queue.textChannel ?? null, cleanupAfterError: cleanup })

    if (cleanup) {
      logger.info('music.error_left_queue_empty', { guildId: queue.id })
      leave(queue.id)
    }
  }

  function onVoiceStateUpdate(oldState: VoiceState): void {
    const voice = player.voices.get(oldState.guild.id)

    if (!leavesEmptyChannel(voice?.channelId ?? null, oldState.channelId, isVoiceChannelEmpty(oldState)))
      return

    logger.info('music.channel_empty', { guildId: oldState.guild.id })
    emitter.queueCleared({ guildId: oldState.guild.id, resetStation: false })
    voice?.leave()
  }

  player.on(Events.ADD_SONG, onAddSong)
  detach.push(() => player.off(Events.ADD_SONG, onAddSong))
  player.on(Events.ADD_LIST, onAddList)
  detach.push(() => player.off(Events.ADD_LIST, onAddList))
  player.on(Events.PLAY_SONG, onPlaySong)
  detach.push(() => player.off(Events.PLAY_SONG, onPlaySong))
  player.on(Events.FINISH, onFinish)
  detach.push(() => player.off(Events.FINISH, onFinish))
  player.on(Events.NO_RELATED, onNoRelated)
  detach.push(() => player.off(Events.NO_RELATED, onNoRelated))
  player.on(Events.DISCONNECT, onDisconnect)
  detach.push(() => player.off(Events.DISCONNECT, onDisconnect))
  player.on(Events.ERROR, onError)
  detach.push(() => player.off(Events.ERROR, onError))

  client.on(DiscordEvents.VoiceStateUpdate, onVoiceStateUpdate)
  detach.push(() => client.off(DiscordEvents.VoiceStateUpdate, onVoiceStateUpdate))

  return { detach, beforeStreamFor }
}
