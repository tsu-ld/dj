import type { DisTube, Queue } from 'distube'
import type { KeyedQueue } from '../../core/async.ts'
import type { Listener, MusicPort, PlaybackStatus, QueueView } from '../../ports/music.ts'
import type { MusicCatalog } from './catalog.ts'
import type { MusicEmitter } from './types.ts'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AudioPlayerStatus } from '@discordjs/voice'
import { UserError } from '../../core/errors.ts'
import { isPositionInQueue } from '../../limits.ts'
import { MESSAGES } from '../../messages.ts'
import { clearStation, removeSongAt, skipSong } from './queue.ts'

type Controls = Pick<MusicPort, 'pause' | 'resume' | 'toggle' | 'skip' | 'stop' | 'shuffle' | 'remove' | 'radio' | 'seek' | 'view' | 'status'>

export function musicControls(deps: {
  player: DisTube
  catalog: MusicCatalog
  mutations: KeyedQueue
  emitter: MusicEmitter
  viewOf: (queue: Queue) => QueueView
  streamReplaced: (queue: Queue) => void
}): Controls {
  const { player, catalog, mutations, emitter, viewOf, streamReplaced } = deps

  function requireQueue(guildId: string): Queue {
    const queue = player.getQueue(guildId)

    if (!queue)
      throw new UserError(MESSAGES.nothingPlaying)

    return queue
  }

  function emitState(queue: Queue): void {
    emitter.stateChanged({
      guildId: queue.id,
      view: viewOf(queue),
      textChannel: queue.textChannel ?? null,
    })
  }

  function status(guildId: string): PlaybackStatus | null {
    const voice = player.voices.get(guildId)

    if (!voice)
      return null

    const status = voice.audioPlayer.state.status
    const playing = status === AudioPlayerStatus.Playing
    const paused = status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused
    // The engine's time adds the seek offset to the resource's own clock; a
    // sought song buffers at that offset, and an idle player still holds the
    // last song's stream, which is no position at all.
    const onAir = playing || paused || status === AudioPlayerStatus.Buffering

    return {
      state: playing ? 'playing' : paused ? 'paused' : 'idle',
      playbackDurationMs: onAir ? Math.round(voice.playbackTime * 1000) : 0,
    }
  }

  // Checked under the guild's lock, where the song cannot change underneath.
  // Only a playing song seeks: one still buffering may be waiting on its spoken
  // line, which a seek would resolve a second time, and a paused one would keep
  // the new stream staged past a skip and play the skipped song on resume. A
  // Spotify song plays a YouTube copy whose length is the one that counts.
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

  // A seek reopens the song's source. The cache may have evicted a playing file
  // (ffmpeg keeps reading its open copy), and reopening it would fail and drop
  // the song.
  function reopenable(url: string | undefined): boolean {
    if (url === undefined)
      return false

    return !url.startsWith('file://') || existsSync(fileURLToPath(url))
  }

  // Reported before the skip, while the song still exists.
  function emitSkipped(queue: Queue, by: Listener): void {
    const current = queue.songs[0]

    if (!current)
      return

    emitter.trackSkipped({
      guildId: queue.id,
      track: catalog.trackOf(current),
      by,
    })
  }

  async function clear(queue: Queue, resetStation: boolean): Promise<void> {
    await clearStation(
      queue,
      () => player.voices.get(queue.id)?.leave(),
      payload => emitter.queueCleared(payload),
      resetStation,
    )
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

        emitSkipped(queue, by)
        await skipSong(queue, async () => clear(queue, false))
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

        if (!Number.isInteger(position) || !isPositionInQueue(queue.songs.length, position))
          throw new UserError(MESSAGES.removeOutOfRange)

        const song = queue.songs[position - 1]

        if (!song)
          throw new UserError(MESSAGES.removeOutOfRange)

        const removed = catalog.trackOf(song).title

        await removeSongAt(queue, position, async () => {
          emitSkipped(queue, by)
          await skipSong(queue, async () => clear(queue, false))
        })

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
