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
import { discordClient, waitForGateway } from './discord/client.ts'
import { interactionHandler } from './discord/interactions.ts'
import { messageHandler } from './discord/messages.ts'
import { messageSlot } from './discord/slot.ts'
import { djAnnouncements } from './dj/announcements.ts'
import { djAgent } from './dj/conversation.ts'
import { djReplies } from './dj/replies.ts'
import { onAirHost } from './on-air/host.ts'
import { intentClassifier } from './providers/classifier/index.ts'
import { conversationModel } from './providers/language-model/index.ts'
import { listenersStore } from './providers/listeners/index.ts'
import { musicEngine } from './providers/music/index.ts'
import { settingsStore } from './providers/settings/index.ts'
import { songFacts } from './providers/song-facts/index.ts'
import { speechSynthesizer } from './providers/speech/index.ts'

export interface App {
  readonly logger: Logger
  start: () => Promise<void>
  stop: () => Promise<void>
}

const SHUTDOWN_TIMEOUT_MS = 5_000

export async function createApp(config: AppConfig): Promise<App> {
  const log = createLogger({ level: config.logLevel }).child({ app: 'dj' })
  const settings = await settingsStore({ path: config.settingsPath, logger: log })
  const client: Client = discordClient(config, log)
  const model = config.language.enabled
    ? conversationModel({ config: config.language, logger: log })
    : null
  const decision = intentClassifier({ config: config.decision, clock: systemClock })
  const speech = speechSynthesizer({ config: config.speech, logger: log, clock: systemClock })
  const replies = djReplies({ model, logger: log })

  const hostRef: { current: OnAirHost | null } = { current: null }

  const music = musicEngine({
    client,
    config: config.music,
    logger: log,
    clock: systemClock,
    beforeStream: async (input) => {
      await hostRef.current?.beforeStream(input)
    },
  })

  const announcements = djAnnouncements({ replies, settings, clock: systemClock })
  const slot = messageSlot({ logger: log, playback: guildId => music.status(guildId) })
  const facts = songFacts({ logger: log })
  const listeners = await listenersStore({ path: config.listenersPath, logger: log, clock: systemClock })
  const host = onAirHost({ music, speech, model, settings, facts, listeners, logger: log, clock: systemClock })

  hostRef.current = host

  const bus = commandBus({ specs: commands, logger: log })
  const agent = model === null ? null : djAgent({ model, bus, settings, logger: log, clock: systemClock })

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
      host.trackQueued(payload)
      slot.queueChanged(payload)
    }),
    music.on('playlistQueued', (payload) => {
      host.playlistQueued(payload)
      slot.playlistQueued(payload)
    }),
    music.on('trackStarted', (payload) => {
      slot.update(payload)
      host.trackStarted(payload)
    }),
    music.on('trackSkipped', (payload) => {
      host.trackSkipped(payload)
    }),
    music.on('stateChanged', (payload) => {
      slot.update(payload)
      host.stateChanged(payload)
    }),
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
      host.playbackError(payload)

      if (payload.cleanupAfterError)
        slot.queueCleared({ guildId: payload.guildId })
    }),
    music.on('disconnected', ({ guildId }) => {
      slot.queueCleared({ guildId })
      host.disconnected(guildId)
    }),
  ]

  const onMessageEvent = (message: Message): void => {
    void onMessage(message)
  }
  const onInteractionEvent = (interaction: Interaction): void => {
    void onInteraction(interaction)
  }

  client.on(Events.MessageCreate, onMessageEvent)
  client.on(Events.InteractionCreate, onInteractionEvent)

  let stopped = false
  const stopping = new AbortController()

  return {
    logger: log,
    async start() {
      log.info('app.starting')

      await waitForGateway({
        fetch,
        sleep: async milliseconds => new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, milliseconds)

          stopping.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
        }),
        logger: log,
        signal: stopping.signal,
      })

      if (stopped)
        return

      await client.login()
      log.info('app.started', { user: client.user?.tag ?? null })
    },
    async stop() {
      if (stopped)
        return

      stopped = true
      stopping.abort()
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

      const steps: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
        ['music', async () => music.dispose()],
        ['on-air', async () => host.dispose()],
        ['speech', async () => speech.dispose()],
        ['settings', async () => settings.flush()],
        ['listeners', async () => listeners.flush()],
        ['discord', async () => client.destroy()],
      ]

      try {
        await withTimeout((async () => {
          for (const [name, step] of steps) {
            try {
              await step()
            }
            catch (error) {
              log.error('app.stop_step_failed', error, { step: name })
            }
          }
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
