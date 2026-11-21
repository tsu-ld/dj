import type { AppConfig } from '../config.ts'
import type { Logger } from '../core/logger.ts'
import { Client, Events, GatewayIntentBits } from 'discord.js'
import { errorMessage } from '../core/errors.ts'

const INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildVoiceStates,
]

const GATEWAY_URL = 'https://discord.com/api/v10/gateway'
const GATEWAY_PROBE_TIMEOUT_MS = 5000
const GATEWAY_RETRY_DELAYS_MS: ReadonlyArray<number> = [
  1000, 2000, 4000, 8000, 15_000, 30_000, 30_000, 30_000,
]

interface GatewayProbe {
  readonly fetch: (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean }>
  readonly sleep: (milliseconds: number) => Promise<void>
  readonly logger: Logger
  readonly signal: AbortSignal
}

// WORKAROUND(https://github.com/discordjs/discord.js/blob/14.27.0/packages/discord.js/src/client/Client.js#L232): a failed login() destroys the client and its gateway manager never reconnects; the gateway is probed until it answers before the one login.
export async function waitForGateway(probe: GatewayProbe): Promise<void> {
  const stopped = (): boolean => probe.signal.aborted

  for (let attempt = 0; ; attempt++) {
    if (stopped()) {
      return
    }

    try {
      const signal = AbortSignal.any([AbortSignal.timeout(GATEWAY_PROBE_TIMEOUT_MS), probe.signal])
      const response = await probe.fetch(GATEWAY_URL, { signal })

      if (response.ok) {
        return
      }
    } catch (error) {
      probe.logger.debug('discord.gateway_probe_failed', { attempt, error: errorMessage(error) })
    }

    const delay = GATEWAY_RETRY_DELAYS_MS[attempt]

    if (delay === undefined || stopped()) {
      return
    }

    probe.logger.warn('discord.gateway_unreachable', { attempt: attempt + 1, retryInMs: delay })
    await probe.sleep(delay)
  }
}

export function discordClient(config: AppConfig, logger: Logger): Client {
  const client = new Client({
    intents: INTENTS,
    allowedMentions: { parse: [], repliedUser: false },
  })

  client.token = config.discord.token

  client.once(Events.ClientReady, (ready) => logger.info('discord.ready', { user: ready.user.tag }))
  client.on(Events.Error, (error) => logger.error('discord.error', error))
  client.on(Events.Warn, (warning) => logger.warn('discord.warning', { warning }))

  return client
}
