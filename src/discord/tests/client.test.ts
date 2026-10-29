import { describe, expect, test } from 'bun:test'
import { loadConfig } from '../../config.ts'
import { logger } from '../../core/logger.ts'
import { discordClient } from '../client.ts'

const config = loadConfig({ DISCORD_TOKEN: 'test-token' })
const log = logger({ level: 'error', sink: () => {} })

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
