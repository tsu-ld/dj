import type { DisTube, Queue } from 'distube'
import type { KeyedQueue } from '../../core/async.ts'
import type { MusicPort, QueueView } from '../../ports/music.ts'
import type { MusicCatalog } from './catalog.ts'
import type { MusicEmitter } from './types.ts'
import { AudioPlayerStatus } from '@discordjs/voice'
import { UserError } from '../../core/errors.ts'
import { MESSAGES } from '../../messages.ts'
import { clearStation, isPositionInQueue, removeSongAt, skipSong } from './queue.ts'

type Controls = Pick<MusicPort, 'pause' | 'resume' | 'toggle' | 'skip' | 'stop' | 'shuffle' | 'remove' | 'radio' | 'view' | 'status'>

export function musicControls(deps: {
  player: DisTube
  catalog: MusicCatalog
  mutations: KeyedQueue
  emitter: MusicEmitter
  viewOf: (queue: Queue) => QueueView
}): Controls {
  const { player, catalog, mutations, emitter, viewOf } = deps

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
    async skip(guildId) {
      await mutations.run(guildId, async () => {
        const queue = requireQueue(guildId)

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
    async remove(guildId, position) {
      return mutations.run(guildId, async () => {
        const queue = requireQueue(guildId)

        if (!Number.isInteger(position) || !isPositionInQueue(queue, position))
          throw new UserError(MESSAGES.removeOutOfRange)

        const song = queue.songs[position - 1]

        if (!song)
          throw new UserError(MESSAGES.removeOutOfRange)

        const removed = catalog.trackOf(song).title

        await removeSongAt(queue, position, async () => skipSong(queue, async () => clear(queue, false)))

        if (player.getQueue(guildId) === queue)
          emitState(queue)

        return removed
      })
    },
    async radio(guildId, on) {
      return mutations.run(guildId, async () => {
        const queue = requireQueue(guildId)

        if (on === undefined)
          queue.toggleAutoplay()
        else
          queue.autoplay = on

        emitState(queue)

        return queue.autoplay
      })
    },
    view(guildId) {
      const queue = player.getQueue(guildId)

      return queue ? viewOf(queue) : null
    },
    status(guildId) {
      const voice = player.voices.get(guildId)

      if (!voice)
        return null

      const state = voice.audioPlayer.state
      const playing = state.status === AudioPlayerStatus.Playing
      const paused = state.status === AudioPlayerStatus.Paused || state.status === AudioPlayerStatus.AutoPaused

      return {
        state: playing ? 'playing' : paused ? 'paused' : 'idle',
        playbackDurationMs: playing || paused ? state.playbackDuration : 0,
      }
    },
  }
}
