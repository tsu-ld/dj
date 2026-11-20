import type { ConversationPort } from '../../ports/conversation.ts'
import type { TestClock } from './support.ts'
import { describe, expect, test } from 'bun:test'
import { ERROR_ANNOUNCE_MS } from '../../limits.ts'
import { MESSAGES } from '../../messages.ts'
import { settle } from '../../tests/fixtures.ts'
import { djAnnouncements } from '../announcements.ts'
import { djReplies } from '../replies.ts'
import {
  scriptedModel,
  silentLog,
  testChannel,
  testClock,
  testSettings,
} from './support.ts'

function nullReply(): ConversationPort {
  return scriptedModel([() => ({ text: null, toolCalls: [] })])
}

function announcer(options: { clock?: TestClock } = {}): ReturnType<typeof djAnnouncements> {
  return djAnnouncements({
    replies: djReplies({ model: nullReply(), logger: silentLog }),
    settings: testSettings(),
    clock: options.clock ?? testClock(),
  })
}

describe('djAnnouncements', () => {
  test('a playback error is announced once per thirty seconds', async () => {
    const channel = testChannel()
    const clock = testClock(1_000_000)
    const announcements = announcer({ clock })
    const payload = { guildId: 'g1', songId: 'song-1', cleanupAfterError: true, textChannel: channel.channel }

    announcements.playbackError(payload)
    await settle()

    clock.advance(29_999)
    announcements.playbackError(payload)
    await settle()

    clock.advance(1)
    announcements.playbackError(payload)
    await settle()

    expect(channel.sent).toEqual([MESSAGES.playbackError, MESSAGES.playbackError])
  })

  test('the throttle slot is taken even when there is no channel', async () => {
    const channel = testChannel()
    const clock = testClock(1_000_000)
    const announcements = announcer({ clock })

    announcements.playbackError({ guildId: 'g1', songId: null, cleanupAfterError: true, textChannel: null })
    await settle()

    clock.advance(1)
    announcements.playbackError({ guildId: 'g1', songId: null, cleanupAfterError: true, textChannel: channel.channel })
    await settle()

    expect(channel.sent).toEqual([])

    clock.advance(ERROR_ANNOUNCE_MS)
    announcements.playbackError({ guildId: 'g1', songId: null, cleanupAfterError: true, textChannel: channel.channel })
    await settle()

    expect(channel.sent).toEqual([MESSAGES.playbackError])
  })

  test('each guild has its own error throttle', async () => {
    const first = testChannel({ id: 'chan-1' })
    const second = testChannel({ id: 'chan-2' })
    const announcements = announcer({ clock: testClock(1_000_000) })

    announcements.playbackError({ guildId: 'g1', songId: null, cleanupAfterError: true, textChannel: first.channel })
    announcements.playbackError({ guildId: 'g2', songId: null, cleanupAfterError: true, textChannel: second.channel })
    await settle()

    expect(first.sent).toEqual([MESSAGES.playbackError])
    expect(second.sent).toEqual([MESSAGES.playbackError])
  })
})
