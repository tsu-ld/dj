import type { Client } from 'discord.js'
import type { Queue, Song } from 'distube'
import type { AppConfig } from '../../config.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { BeforeStreamInput, MusicPort, QueueView } from '../../ports/music.ts'
import { createAudioPlayer, createAudioResource } from '@discordjs/voice'
import { SpotifyPlugin } from '@distube/spotify'
import { DisTube } from 'distube'
import { keyedQueue } from '../../core/async.ts'
import { errorMessage } from '../../core/errors.ts'
import { audioHealth } from './audio-health.ts'
import { audioOverMusic } from './audio-over-music.ts'
import { audioCache } from './cache.ts'
import { MusicCatalog } from './catalog.ts'
import { musicControls } from './controls.ts'
import { createEmitter } from './emitter.ts'
import { musicEvents } from './events.ts'
import { extractor } from './extraction.ts'
import { MetadataCatalog } from './metadata.ts'
import { musicPlay } from './play.ts'
import { currentForStream, queueView } from './queue.ts'
import { streamResolver } from './stream.ts'

interface MusicEngineDeps {
  client: Client
  config: AppConfig['music']
  logger: Logger
  clock: Clock
  beforeStream: (input: BeforeStreamInput) => Promise<void>
}

export function musicEngine(deps: MusicEngineDeps): MusicPort {
  const logger = deps.logger.child({ module: 'music' })
  const extraction = extractor({ command: deps.config.extractorCommand, logger })
  const cache = audioCache({
    dir: deps.config.cacheDir,
    maxBytes: deps.config.cacheMaxBytes,
    maxAgeMs: deps.config.cacheMaxAgeMs,
    extraction,
    logger,
  })

  const stream = streamResolver({ cache, extraction, clock: deps.clock, logger, beforeStream: beforeStreamFor })
  const catalog = new MusicCatalog({ extraction, stream, logger })

  const player = new DisTube(deps.client, {
    plugins: [metadataPlugin(), catalog],
    emitAddListWhenCreatingQueue: true,
    emitAddSongWhenCreatingQueue: false,
    savePreviousSongs: false,
    ffmpeg: {
      args: {
        // the downloaded mp4 carries video too; extract only the audio stream
        output: { map: '0:a' },
      },
    },
  })

  const mutations = keyedQueue()
  const { emitter, clear: clearEvents } = createEmitter()
  const health = audioHealth({ clock: deps.clock, logger })
  let disposed = false

  const audio = audioOverMusic({
    access: {
      voice(guildId) {
        return player.voices.get(guildId) ?? null
      },
      queue(guildId) {
        return player.getQueue(guildId) ?? null
      },
      async join(channel) {
        return player.voices.join(channel)
      },
    },
    logger,
    welcomeFile: deps.config.welcomeFile,
    createPlayer: createAudioPlayer,
    createResource: createAudioResource,
  })

  function metadataPlugin(): MetadataCatalog {
    const source = deps.config.metadata.enabled
      ? new SpotifyPlugin({
          api: {
            clientId: deps.config.metadata.clientId,
            clientSecret: deps.config.metadata.clientSecret,
          },
        })
      : new SpotifyPlugin()

    return new MetadataCatalog({ source, logger })
  }

  function viewOf(queue: Queue): QueueView {
    return queueView(queue, song => catalog.trackOf(song))
  }

  function leave(guildId: string): void {
    player.voices.get(guildId)?.leave()
  }

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

    if (!queue || !currentForStream(song, queue))
      return

    await deps.beforeStream({ guildId: queue.id, view: viewOf(queue) })
  }

  const events = musicEvents({
    player,
    client: deps.client,
    catalog,
    cache,
    emitter,
    forgetStream: songId => stream.forget(songId),
    leave,
    viewOf,
    health,
    logger,
  })

  const play = musicPlay({ player, catalog, audio, mutations, logger })
  const controls = musicControls({ player, catalog, mutations, emitter, viewOf, leave, streamReplaced: events.watchStream })

  return {
    play,
    ...controls,
    audio,
    on: emitter.on,
    async dispose() {
      if (disposed)
        return

      disposed = true

      for (const off of events.detach) off()

      health.dispose()
      await audio.dispose()

      for (const queue of [...player.queues.collection.values()]) {
        await queue.stop().catch((error: unknown) => {
          logger.warn('music.stop_failed', { guildId: queue.id, error: errorMessage(error) })
        })
      }

      for (const voice of [...player.voices.collection.values()])
        voice.leave()

      clearEvents()
      stream.dispose()
      cache.dispose()
      await extraction.dispose()
    },
  }
}
