import type { Client, VoiceState } from 'discord.js'
import type { Playlist, Queue, Song } from 'distube'
import type { Logger } from '../../core/logger.ts'
import type { BeforeStreamInput, QueueView } from '../../ports/music.ts'
import type { AudioEndReason, AudioHealth } from './audio-health.ts'
import type { AudioCache } from './cache.ts'
import type { MusicCatalog } from './catalog.ts'
import type { MusicEmitter } from './types.ts'
import { Events as DiscordEvents } from 'discord.js'
import { Events, isVoiceChannelEmpty } from 'distube'
import { errorMessage } from '../../core/errors.ts'
import { leavesEmptyChannel, shouldCleanupAfterError } from './queue.ts'
import { voiceGuard } from './voice-guard.ts'

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

// An ffmpeg stream the engine hands audio from; the SDK swaps the one listener
// it keeps from song to song.
type StreamOf = NonNullable<Queue['voice']['stream']>

export function musicEvents(deps: {
  player: import('distube').DisTube
  client: Client
  catalog: MusicCatalog
  cache: AudioCache
  emitter: MusicEmitter
  beforeStream: (input: BeforeStreamInput) => Promise<void>
  forgetStream: (songId: string) => void
  leave: (guildId: string) => void
  viewOf: (queue: Queue) => QueueView
  health: AudioHealth
  logger: Logger
}): { detach: Array<() => void>, beforeStreamFor: (song: Song) => Promise<void> } {
  const { player, client, catalog, cache, emitter, beforeStream, forgetStream, leave, viewOf, health, logger } = deps
  const lastSong = new Map<string, string>()
  const detach: Array<() => void> = []
  // The streams this process has listened to. The listener closes over nothing
  // but the stream and the logger, so it dies with the stream and a late exit
  // after teardown can never be uncaught; this set only keeps us from adding a
  // second one.
  const noted = new WeakSet<StreamOf>()
  // The ffmpeg streams each guild's music has seen, newest last. Two are enough:
  // the one playing and the one the SDK just stopped listening to (see watchStream).
  const watched = new Map<string, Array<StreamOf>>()
  const guardVoice = voiceGuard(logger)

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

  // A stream the SDK stopped listening to but did not stop: its ffmpeg exits
  // later, on its own. Ours stays on the streams we have seen so that exit
  // cannot be uncaught, and it names the exit at most once: the engine reports
  // the song it is playing, and reporting an orphan too would report it twice.
  function orphanedStreamFailed(guildId: string, stream: StreamOf, error: Error): void {
    const queue = player.getQueue(guildId) ?? null

    // The engine reports the stream it is playing, and it may have deleted the
    // queue before handing us the error. Anything else is an orphan, and so is
    // every error once this guild is no longer watched: naming it and stopping
    // it is all that is left.
    if (watched.has(guildId) && queue !== null && queue.voice.stream === stream)
      return

    logger.warn('music.orphan_stream_failed', { guildId, error: errorMessage(error) })
    stream.kill()
  }

  // An EventEmitter throws on "error" when nothing listens, and that is what
  // killed the process: the engine moves its only listener to the next song's
  // stream and leaves the previous ffmpeg alive, so a late exit code from that
  // orphan is uncaught. Ours stays on every stream we have seen.
  function watchStream(queue: Queue): void {
    const stream = queue.voice.stream

    if (stream === undefined)
      return

    if (!noted.has(stream)) {
      noted.add(stream)
      stream.on('error', (error: Error) => orphanedStreamFailed(queue.id, stream, error))
    }

    const seen = watched.get(queue.id) ?? []

    if (seen.includes(stream))
      return

    seen.push(stream)

    // Only the song playing and the one just replaced can still be running.
    while (seen.length > 2)
      seen.shift()

    watched.set(queue.id, seen)
  }

  // The map is what leaks, so a finished, cleared or disconnected queue drops
  // its entry and the next song starts from scratch. The stream listeners stay:
  // the stream outlives the queue, and its exit must never be uncaught.
  function unwatch(guildId: string): void {
    watched.delete(guildId)
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
    })
  }

  function onAddList(queue: Queue, playlist: Playlist): void {
    const name = playlist.name ?? playlist.url ?? 'Playlist'
    const count = playlist.songs.length

    logger.info('music.playlist_added', { guildId: queue.id, name, count })

    emitter.playlistQueued({
      guildId: queue.id,
      name,
      count,
      view: viewOf(queue),
      textChannel: queue.textChannel ?? null,
    })
  }

  function onPlaySong(queue: Queue, song: Song): void {
    const title = song.name ?? song.id

    logger.info('music.playing', { guildId: queue.id, title })
    lastSong.set(queue.id, song.id)
    guardVoice(queue.id, queue.voice)
    watchStream(queue)
    health.start({
      guildId: queue.id,
      title,
      ping: () => ({ ws: queue.voice.connection.ping.ws, udp: queue.voice.connection.ping.udp }),
    })
    emitter.trackStarted({
      guildId: queue.id,
      track: catalog.trackOf(song),
      view: viewOf(queue),
      textChannel: queue.textChannel ?? null,
    })
    cache.prefetch(queue.songs[1], queue.id)
  }

  // A song's session ends when the engine says so, and also when the queue is
  // stopped or cleared: a stop deletes it without FINISH or DISCONNECT, which
  // would leave the sample timer pinging a connection that is already gone.
  function ended(guildId: string, reason: AudioEndReason): void {
    health.end(guildId, reason)
    unwatch(guildId)
  }

  // The engine reports the finished song before the next one replaces it, which
  // is the boundary the audio summary belongs to; a skip goes through here too,
  // already summarised by the emitter's trackSkipped.
  function onFinishSong(queue: Queue): void {
    ended(queue.id, 'finished')
  }

  function onFinish(queue: Queue): void {
    logger.info('music.queue_finished', { guildId: queue.id })
    ended(queue.id, 'finished')
    emitter.queueEnded({ guildId: queue.id })
    leave(queue.id)
  }

  function onNoRelated(queue: Queue): void {
    logger.info('music.no_related', { guildId: queue.id })
    ended(queue.id, 'finished')
    emitter.queueEnded({ guildId: queue.id })
    leave(queue.id)
  }

  function onDisconnect(queue: Queue): void {
    ended(queue.id, 'finished')
    emitter.disconnected({ guildId: queue.id })
  }

  function onError(error: Error, queue: Queue | undefined, song: Song | undefined): void {
    logger.error('music.playback_error', error, { guildId: queue?.id })

    if (!queue)
      return

    health.end(queue.id, 'error')

    // A remembered progressive url can answer 403 after a few plays. Forget it
    // for this song so the next request resolves a fresh one instead of failing
    // on the same dead url for the rest of its lifetime.
    const failed = lastSong.get(queue.id)

    if (failed !== undefined)
      forgetStream(failed)

    const cleanup = shouldCleanupAfterError(queue, player.getQueue(queue.id))

    const songId = song?.id ?? failed ?? null

    emitter.playbackError({ guildId: queue.id, songId, textChannel: queue.textChannel ?? null, cleanupAfterError: cleanup })

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

  // The engine's finish and disconnect are not the only ends: a clear or a stop
  // goes through the emitter, so the session and its streams close there too.
  detach.push(emitter.on('trackSkipped', ({ guildId }) => ended(guildId, 'skipped')))
  detach.push(emitter.on('queueCleared', ({ guildId }) => ended(guildId, 'stopped')))
  detach.push(emitter.on('queueEnded', ({ guildId }) => ended(guildId, 'finished')))
  detach.push(emitter.on('disconnected', ({ guildId }) => ended(guildId, 'finished')))

  player.on(Events.ADD_SONG, onAddSong)
  detach.push(() => player.off(Events.ADD_SONG, onAddSong))
  player.on(Events.ADD_LIST, onAddList)
  detach.push(() => player.off(Events.ADD_LIST, onAddList))
  player.on(Events.PLAY_SONG, onPlaySong)
  detach.push(() => player.off(Events.PLAY_SONG, onPlaySong))
  player.on(Events.FINISH_SONG, onFinishSong)
  detach.push(() => player.off(Events.FINISH_SONG, onFinishSong))
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
  detach.push(() => watched.clear())

  return { detach, beforeStreamFor }
}
