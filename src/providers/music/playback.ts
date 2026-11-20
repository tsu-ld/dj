import type { Client } from 'discord.js'
import type { Queue, Song } from 'distube'
import type { AppConfig } from '../../config.ts'
import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { BeforeStreamInput, MusicPort, QueueView } from '../../ports/music.ts'
import { SpotifyPlugin } from '@distube/spotify'
import { DisTube } from 'distube'
import { keyedQueue } from '../../core/async.ts'
import { errorMessage } from '../../core/errors.ts'
import { audioHealth } from './audio-health.ts'
import { audioCache } from './cache.ts'
import { MusicCatalog } from './catalog.ts'
import { musicControls } from './controls.ts'
import { createEmitter } from './emitter.ts'
import { musicEvents } from './events.ts'
import { extractor } from './extraction.ts'
import { MetadataCatalog } from './metadata.ts'
import { musicPlay } from './play.ts'
import { queueView } from './queue.ts'
import { streamResolver } from './stream.ts'
import { audioOverMusic } from './welcome.ts'

export interface MusicEngineDeps {
  client: Client
  config: AppConfig['music']
  logger: Logger
  clock: Clock
  beforeStream: (input: BeforeStreamInput) => Promise<void>
}

export function musicPlayback(deps: MusicEngineDeps): MusicPort {
  const logger = deps.logger.child({ module: 'music' })
  const extraction = extractor({ command: deps.config.extractorCommand, logger })
  const cache = audioCache({
    dir: deps.config.cacheDir,
    maxBytes: deps.config.cacheMaxBytes,
    maxAgeMs: deps.config.cacheMaxAgeMs,
    extraction,
    logger,
  })
  let beforeStreamFor: (song: Song) => Promise<void> = async () => {}

  const stream = streamResolver({
    cache,
    extraction,
    clock: deps.clock,
    logger,
    beforeStream: async song => beforeStreamFor(song),
  })
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

  const events = musicEvents({
    player,
    client: deps.client,
    catalog,
    cache,
    emitter,
    beforeStream: deps.beforeStream,
    forgetStream: songId => stream.forget(songId),
    leave,
    viewOf,
    health,
    logger,
  })

  beforeStreamFor = events.beforeStreamFor

  const play = musicPlay({ player, catalog, audio, mutations, logger })
  // A seek replaces the song's ffmpeg stream without a new song event.
  const controls = musicControls({ player, catalog, mutations, emitter, viewOf, streamReplaced: events.watchStream })

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
