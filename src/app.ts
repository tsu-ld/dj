import type { Client, Interaction, Message } from 'discord.js'
import type { AppConfig } from './config.ts'
import type { Logger } from './core/logger.ts'
import type { OnAirHost } from './on-air/host.ts'
import { Events } from 'discord.js'
import { commandBus } from './commands/bus.ts'
import { commands } from './commands/index.ts'
import { withTimeout } from './core/async.ts'
import { systemClock } from './core/clock.ts'
import { errorMessage } from './core/errors.ts'
import { logger as createLogger } from './core/logger.ts'
import { discordClient } from './discord/client.ts'
import { interactionHandler } from './discord/interactions.ts'
import { messageHandler } from './discord/messages.ts'
import { messageSlot } from './discord/slot.ts'
import { djAnnouncements } from './dj/announcements.ts'
import { djAgent } from './dj/conversation.ts'
import { djReplies } from './dj/replies.ts'
import { onAirHost } from './on-air/host.ts'
import { intentClassifier } from './providers/classifier/index.ts'
import { conversationModel } from './providers/language-model/index.ts'
import { musicEngine } from './providers/music/index.ts'
import { settingsStore } from './providers/settings/index.ts'
import { speechSynthesizer } from './providers/speech/index.ts'

export interface App {
  readonly logger: Logger
  start: () => Promise<void>
  stop: () => Promise<void>
}

const SHUTDOWN_TIMEOUT_MS = 5_000

// The only place that knows every layer. Ports are wired here; no feature
// imports a provider, and no provider imports a feature.
export async function createApp(config: AppConfig): Promise<App> {
  const log = createLogger({ level: config.logLevel }).child({ app: 'dj' })
  const clock = systemClock
  const settings = await settingsStore({ path: config.settingsPath, logger: log })
  const client: Client = discordClient(config, log)
  const model = config.language.enabled
    ? conversationModel({ config: config.language, logger: log })
    : null
  const decision = intentClassifier({ config: config.decision, logger: log, clock })
  const speech = speechSynthesizer({ config: config.speech, logger: log, clock })
  const slot = messageSlot({ logger: log })
  const replies = djReplies({ model, logger: log })
  const announcements = djAnnouncements({ model, settings, logger: log, clock })

  const hostRef: { current: OnAirHost | null } = { current: null }

  // The music engine needs the hook before the host exists, and the host needs
  // the engine. The hook only runs after login, so the holder is always set by
  // then; a null holder means a stream started before wiring, which skips the
  // line instead of crashing the song.
  const music = musicEngine({
    client,
    config: config.music,
    logger: log,
    clock,
    beforeStream: async (input) => {
      await hostRef.current?.beforeStream(input)
    },
  })

  const host = onAirHost({ music, speech, model, settings, logger: log, clock })

  hostRef.current = host

  const bus = commandBus({ specs: commands, logger: log })
  const agent = model === null ? null : djAgent({ model, bus, settings, logger: log, clock })

  const onMessage = messageHandler({
    bus,
    music,
    settings,
    replies,
    slot,
    decision,
    agent,
    logger: log,
    cooldowns: config.cooldowns,
  })
  const onInteraction = interactionHandler({ bus, music, settings, slot, logger: log })

  const detach: Array<() => void> = [
    music.on('trackQueued', (payload) => {
      announcements.trackQueued(payload)
      host.trackQueued(payload)
    }),
    music.on('playlistQueued', (payload) => {
      announcements.playlistQueued(payload)
      host.playlistQueued(payload)
      slot.playlistQueued(payload)
    }),
    music.on('trackStarted', payload => slot.trackStarted(payload)),
    music.on('stateChanged', payload => slot.stateChanged(payload)),
    music.on('queueEnded', ({ guildId }) => slot.queueCleared({ guildId })),
    music.on('queueCleared', (payload) => {
      slot.queueCleared(payload)

      if (payload.resetStation)
        host.reset(payload.guildId)
      else
        host.disconnected(payload.guildId)
    }),
    music.on('playbackError', (payload) => {
      announcements.playbackError(payload)

      // Only the queue that actually failed and is now empty loses its cards;
      // a replacement queue must keep them.
      if (payload.cleanupAfterError)
        slot.queueCleared({ guildId: payload.guildId })
    }),
    music.on('disconnected', ({ guildId }) => host.disconnected(guildId)),
  ]

  const onMessageEvent = (message: Message): void => {
    void onMessage(message)
  }
  const onInteractionEvent = (interaction: Interaction): void => {
    void onInteraction(interaction)
  }

  client.on(Events.MessageCreate, onMessageEvent)
  client.on(Events.InteractionCreate, onInteractionEvent)

  let started = false
  let stopped = false

  return {
    logger: log,
    async start() {
      if (started)
        return

      started = true
      log.info('app.starting')

      await client.login()
      log.info('app.started', { user: client.user?.tag ?? null })
    },
    async stop() {
      if (stopped)
        return

      stopped = true
      log.info('app.stopping')

      for (const off of detach) {
        try {
          off()
        }
        catch (error) {
          log.warn('app.detach_failed', { error: errorMessage(error) })
        }
      }

      client.off(Events.MessageCreate, onMessageEvent)
      client.off(Events.InteractionCreate, onInteractionEvent)
      slot.dispose()

      try {
        await withTimeout((async () => {
          await music.dispose()
          await host.dispose()
          await speech.dispose()
          await settings.flush()
          await client.destroy()
        })(), SHUTDOWN_TIMEOUT_MS, 'graceful shutdown timed out')
      }
      catch (error) {
        log.error('app.stop_failed', error)
        await client.destroy().catch(() => {})
      }

      log.info('app.stopped')
    },
  }
}
