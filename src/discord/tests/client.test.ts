import { describe, expect, test } from 'bun:test'
import { loadConfig } from '../../config.ts'
import { silentLog as log } from '../../tests/fixtures.ts'
import { discordClient, waitForGateway } from '../client.ts'

const config = loadConfig({ DISCORD_TOKEN: 'test-token' })

describe('discordClient', () => {
  test('mentions are disabled by default for every message the bot sends', () => {
    const client = discordClient(config, log)

    expect(client.options.allowedMentions).toEqual({ parse: [], repliedUser: false })
  })

  test('the token comes from the config', () => {
    const client = discordClient(config, log)

    expect(client.token).toBe('test-token')
  })
})

function probe(
  outcomes: ReadonlyArray<'ok' | 'down' | 'error'>,
  signal = new AbortController().signal,
) {
  const urls: Array<string> = []
  const slept: Array<number> = []
  let call = 0

  return {
    urls,
    slept,
    probe: {
      logger: log,
      signal,
      sleep: async (milliseconds: number) => {
        slept.push(milliseconds)
      },
      fetch: async (url: string) => {
        urls.push(url)

        const outcome = outcomes[Math.min(call++, outcomes.length - 1)]

        if (outcome === 'error') {
          throw new TypeError('getaddrinfo ETIMEOUT discord.com')
        }

        return { ok: outcome === 'ok' }
      },
    },
  }
}

describe('waitForGateway', () => {
  test('a reachable gateway is used at once', async () => {
    const fake = probe(['ok'])

    await waitForGateway(fake.probe)

    expect(fake.urls).toEqual(['https://discord.com/api/v10/gateway'])
    expect(fake.slept).toEqual([])
  })

  test('a network that comes up late is waited for with growing delays', async () => {
    const fake = probe(['error', 'error', 'down', 'ok'])

    await waitForGateway(fake.probe)

    expect(fake.slept).toEqual([1000, 2000, 4000])
    expect(fake.urls).toHaveLength(4)
  })

  test('a network that never comes up gives up after the budget', async () => {
    const fake = probe(['error'])

    await waitForGateway(fake.probe)

    expect(fake.slept).toEqual([1000, 2000, 4000, 8000, 15_000, 30_000, 30_000, 30_000])
    expect(fake.urls).toHaveLength(9)
  })

  test('a stop during the wait ends it without another probe', async () => {
    const stop = new AbortController()
    const fake = probe(['error'], stop.signal)

    fake.probe.sleep = async (milliseconds: number) => {
      fake.slept.push(milliseconds)
      stop.abort()
    }

    await waitForGateway(fake.probe)

    expect(fake.slept).toEqual([1000])
    expect(fake.urls).toHaveLength(1)
  })
})
