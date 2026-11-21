import type { DisTube, Queue } from 'distube'
import type { KeyedQueue } from '../../core/async.ts'
import type { Listener, MusicPort, PlaybackStatus, QueueView } from '../../ports/music.ts'
import type { MusicCatalog } from './catalog.ts'
import type { MusicEmitter } from './emitter.ts'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AudioPlayerStatus } from '@discordjs/voice'
import { UserError } from '../../core/errors.ts'
import { MESSAGES } from '../../messages.ts'
import { addressOf, removeSongAt, skipSong } from './queue.ts'

type Controls = Pick<MusicPort, 'pause' | 'resume' | 'toggle' | 'skip' | 'stop' | 'shuffle' | 'remove' | 'radio' | 'seek' | 'view' | 'status'>

export function musicControls(deps: {
  player: DisTube
  catalog: MusicCatalog
  mutations: KeyedQueue
  emitter: MusicEmitter
  viewOf: (queue: Queue) => QueueView
  leave: (guildId: string) => void
  streamReplaced: (queue: Queue) => void
}): Controls {
  const { player, catalog, mutations, emitter, viewOf, leave, streamReplaced } = deps

  function requireQueue(guildId: string): Queue {
    const queue = player.getQueue(guildId)

    if (!queue)
      throw new UserError(MESSAGES.nothingPlaying)

    return queue
  }

  function emitState(queue: Queue): void {
    emitter.emit('stateChanged', { ...addressOf(queue), view: viewOf(queue) })
  }

  function status(guildId: string): PlaybackStatus | null {
    const voice = player.voices.get(guildId)

    if (!voice)
      return null

    const status = voice.audioPlayer.state.status
    const playing = status === AudioPlayerStatus.Playing
    const paused = status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused
    // the SDK's playbackTime includes the seek offset while buffering, and an
    // idle player still reports the last song's stream
    const onAir = playing || paused || status === AudioPlayerStatus.Buffering

    return {
      state: playing ? 'playing' : paused ? 'paused' : 'idle',
      playbackDurationMs: onAir ? Math.round(voice.playbackTime * 1000) : 0,
    }
  }

  // A seek on a buffering song makes the SDK resolve its stream again, and on a
  // paused one it stages the new stream past a skip and plays the skipped song on resume.
  function seekableLength(guildId: string, queue: Queue, songId: string): number {
    const song = queue.songs[0]

    if (!song || song.id !== songId)
      throw new UserError(MESSAGES.seekStale)

    const played = song.stream.playFromSource ? song : song.stream.song
    const length = Math.min(song.duration, played?.duration ?? 0)
    const url = played?.stream.playFromSource ? played.stream.url : undefined

    if (song.isLive || !(length > 0) || status(guildId)?.state !== 'playing' || !reopenable(url))
      throw new UserError(MESSAGES.seekUnavailable)

    return length
  }

  // ffmpeg keeps reading an evicted file it has open, but a seek reopens the source.
  function reopenable(url: string | undefined): boolean {
    if (url === undefined)
      return false

    return !url.startsWith('file://') || existsSync(fileURLToPath(url))
  }

  async function skipCurrent(queue: Queue, by: Listener): Promise<void> {
    const current = queue.songs[0]

    if (current)
      emitter.emit('trackSkipped', { guildId: queue.id, track: catalog.trackOf(current), by })

    await skipSong(queue, async () => clear(queue, false))
  }

  async function clear(queue: Queue, resetStation: boolean): Promise<void> {
    // the SDK's queue.stop() neither disconnects nor emits FINISH
    await queue.stop()
    leave(queue.id)
    emitter.emit('queueCleared', { guildId: queue.id, resetStation })
  }

  return {
    async pause(guildId) {
      await mutations.run(guildId, async () => {
        const queue = requireQueue(guildId)

        if (!queue.paused)
          await queue.pause()

        emitState(queue)
      })
    },
    async resume(guildId) {
      await mutations.run(guildId, async () => {
        const queue = requireQueue(guildId)

        if (queue.paused)
          await queue.resume()

        emitState(queue)
      })
    },
    async toggle(guildId) {
      return mutations.run(guildId, async () => {
        const queue = requireQueue(guildId)

        await (queue.paused ? queue.resume() : queue.pause())
        emitState(queue)

        return queue.paused
      })
    },
    async skip(guildId, by) {
      await mutations.run(guildId, async () => {
        const queue = requireQueue(guildId)

        await skipCurrent(queue, by)
      })
    },
    async stop(guildId, options) {
      await mutations.run(guildId, async () => {
        const queue = requireQueue(guildId)

        await clear(queue, options?.resetStation === true)
      })
    },
    async shuffle(guildId) {
      await mutations.run(guildId, async () => {
        const queue = requireQueue(guildId)

        await queue.shuffle()
        emitState(queue)
      })
    },
    async remove(guildId, position, by) {
      return mutations.run(guildId, async () => {
        const queue = requireQueue(guildId)

        const song = queue.songs[position - 1]

        if (!song)
          throw new UserError(MESSAGES.removeOutOfRange)

        const removed = catalog.trackOf(song).title

        await removeSongAt(queue, position, async () => skipCurrent(queue, by))

        if (player.getQueue(guildId) === queue)
          emitState(queue)

        return removed
      })
    },
    async radio(guildId) {
      return mutations.run(guildId, async () => {
        const queue = requireQueue(guildId)

        queue.toggleAutoplay()

        emitState(queue)

        return queue.autoplay
      })
    },
    async seek(guildId, songId, seconds) {
      await mutations.run(guildId, async () => {
        const queue = requireQueue(guildId)
        const length = seekableLength(guildId, queue, songId)

        await queue.seek(Math.min(Math.max(Math.floor(seconds), 0), Math.floor(length) - 1))
        streamReplaced(queue)
        emitState(queue)
      })
    },
    view(guildId) {
      const queue = player.getQueue(guildId)

      return queue ? viewOf(queue) : null
    },
    status,
  }
}
