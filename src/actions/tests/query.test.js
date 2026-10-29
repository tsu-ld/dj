import { expect, test } from 'bun:test'
import { ChannelType } from 'discord.js'
import { MESSAGES } from '../../messages.js'
import { getAction } from '../index.js'

function context() {
  return {
    guildId: 'g1',
    voiceChannel: {
      type: ChannelType.GuildVoice,
      permissionsFor: () => ({ has: () => true }),
    },
    message: { guild: { members: { me: {} } } },
    textChannel: {},
    member: {},
  }
}

test('a direct query rejects links outside the music allowlist', async () => {
  for (const url of ['https://example.com/song', 'http://127.0.0.1/audio', 'file:///etc/passwd']) {
    await expect(getAction('query').run({ query: url }, context()))
      .rejects
      .toThrow(MESSAGES.unsupportedUrl)
  }
})
