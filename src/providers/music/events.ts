import type { Client, VoiceState } from 'discord.js'
import type { Playlist, Queue, Song } from 'distube'
import type { Logger } from '../../core/logger.ts'
import type { QueueView } from '../../ports/music.ts'
import type { AudioEndReason, AudioHealth } from './audio-health.ts'
import type { AudioCache } from './cache.ts'
import type { MusicCatalog } from './catalog.ts'
import type { MusicEmitter } from './types.ts'
import { Events as DiscordEvents } from 'discord.js'
import { Events, isVoiceChannelEmpty } from 'distube'
import { errorMessage } from '../../core/errors.ts'
import { leavesEmptyChannel, shouldCleanupAfterError } from './queue.ts'
import { voiceGuard } from './voice-guard.ts'

type StreamOf = NonNullable<Queue['voice']['stream']>

export function musicEvents(deps: {
  player: import('distube').DisTube
  client: Client
  catalog: MusicCatalog
  cache: AudioCache
  emitter: MusicEmitter
  forgetStream: (songId: string) => void
  leave: (guildId: string) => void
  viewOf: (queue: Queue) => QueueView
  health: AudioHealth
  logger: Logger
}): { detach: Array<() => void>, watchStream: (queue: Queue) => void } {
  const { player, client, catalog, cache, emitter, forgetStream, leave, viewOf, health, logger } = deps
  const lastSong = new Map<string, string>()
  const detach: Array<() => void> = []
  const noted = new WeakSet<StreamOf>()
  const watched = new Map<string, Array<StreamOf>>()
  const guardVoice = voiceGuard(logger)

  function orphanedStreamFailed(guildId: string, stream: StreamOf, error: Error): void {
    const queue = player.getQueue(guildId) ?? null

    if (watched.has(guildId) && queue !== null && queue.voice.stream === stream)
      return

    logger.warn('music.orphan_stream_failed', { guildId, error: errorMessage(error) })
    stream.kill()
  }

  // The SDK moves its only "error" listener to the next song's stream and leaves
  // the previous ffmpeg running; an EventEmitter with no "error" listener throws,
  // so that orphan's late exit would be uncaught. Ours stays on every stream.
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

    while (seen.length > 2)
      seen.shift()

    watched.set(queue.id, seen)
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
      view: viewOf(queue),
      textChannel: queue.textChannel ?? null,
    })
    cache.prefetch(queue.songs[1], queue.id)
  }

  function ended(guildId: string, reason: AudioEndReason): void {
    health.end(guildId, reason)
    watched.delete(guildId)
  }

  function onFinishSong(queue: Queue): void {
    ended(queue.id, 'finished')
  }

  function queueEnded(event: 'music.queue_finished' | 'music.no_related'): (queue: Queue) => void {
    return (queue) => {
      logger.info(event, { guildId: queue.id })
      emitter.queueEnded({ guildId: queue.id })
      leave(queue.id)
    }
  }

  const onFinish = queueEnded('music.queue_finished')
  const onNoRelated = queueEnded('music.no_related')

  function onDisconnect(queue: Queue): void {
    emitter.disconnected({ guildId: queue.id })
  }

  function onError(error: Error, queue: Queue | undefined, song: Song | undefined): void {
    logger.error('music.playback_error', error, { guildId: queue?.id })

    if (!queue)
      return

    health.end(queue.id, 'error')

    // A remembered googlevideo url can start answering 403 after a few plays.
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

  // queue.stop() emits neither FINISH_SONG nor DISCONNECT, so a stop or clear
  // must end the session through the emitter.
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

  return { detach, watchStream }
}
