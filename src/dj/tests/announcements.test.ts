import type { ConversationPort } from '../../ports/conversation.ts'
import { describe, expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.ts'
import { djAnnouncements } from '../announcements.ts'
import {
  scriptedModel,
  silentLogger,
  testChannel,
  testClock,
  testSettings,
  testTrack,
  testView,
} from './support.ts'

function nullReply(): ConversationPort {
  return scriptedModel([() => ({ text: null, toolCalls: [] })])
}

async function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('djAnnouncements', () => {
  test('a suppressed song does not announce', async () => {
    const channel = testChannel()
    const announcements = djAnnouncements({
      model: nullReply(),
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    announcements.trackQueued({
      guildId: 'g1',
      track: testTrack('La mano de Dios'),
      view: testView(),
      textChannel: channel.channel,
      announce: false,
    })
    await settle()

    expect(channel.sent).toEqual([])
  })

  test('a song without a text channel is not announced', async () => {
    const model = scriptedModel([() => ({ text: null, toolCalls: [] })])
    const announcements = djAnnouncements({
      model,
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    announcements.trackQueued({
      guildId: 'g1',
      track: testTrack('La mano de Dios'),
      view: testView(),
      textChannel: null,
      announce: true,
    })
    await settle()

    expect(model.requests).toHaveLength(0)
  })

  test('an added song is announced through the replies capability', async () => {
    const channel = testChannel()
    const announcements = djAnnouncements({
      model: nullReply(),
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    announcements.trackQueued({
      guildId: 'g1',
      track: testTrack('La mano de Dios'),
      view: testView(),
      textChannel: channel.channel,
      announce: true,
    })
    await settle()

    expect(channel.sent).toEqual([MESSAGES.songAdded('La mano de Dios')])
  })

  test('an added playlist is announced with its count', async () => {
    const channel = testChannel()
    const announcements = djAnnouncements({
      model: nullReply(),
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    announcements.playlistQueued({
      guildId: 'g1',
      name: 'Cumbia',
      count: 12,
      view: testView(),
      textChannel: channel.channel,
      announce: true,
    })
    await settle()

    expect(channel.sent).toEqual([MESSAGES.playlistAdded('Cumbia', 12)])
  })

  test('a suppressed playlist does not announce', async () => {
    const channel = testChannel()
    const announcements = djAnnouncements({
      model: nullReply(),
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    announcements.playlistQueued({
      guildId: 'g1',
      name: 'Cumbia',
      count: 12,
      view: testView(),
      textChannel: channel.channel,
      announce: false,
    })
    await settle()

    expect(channel.sent).toEqual([])
  })

  test('a playback error is announced once per thirty seconds', async () => {
    const channel = testChannel()
    const clock = testClock(1_000_000)
    const announcements = djAnnouncements({
      model: nullReply(),
      settings: testSettings(),
      logger: silentLogger(),
      clock,
    })
    const payload = { guildId: 'g1', error: new Error('boom'), cleanupAfterError: true, textChannel: channel.channel }

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
    const announcements = djAnnouncements({
      model: nullReply(),
      settings: testSettings(),
      logger: silentLogger(),
      clock,
    })

    announcements.playbackError({ guildId: 'g1', error: new Error('boom'), cleanupAfterError: true, textChannel: null })
    await settle()

    clock.advance(1)
    announcements.playbackError({ guildId: 'g1', error: new Error('boom'), cleanupAfterError: true, textChannel: channel.channel })
    await settle()

    expect(channel.sent).toEqual([])
  })

  test('each guild has its own error throttle', async () => {
    const first = testChannel({ id: 'chan-1' })
    const second = testChannel({ id: 'chan-2' })
    const announcements = djAnnouncements({
      model: nullReply(),
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(1_000_000),
    })

    announcements.playbackError({ guildId: 'g1', error: new Error('boom'), cleanupAfterError: true, textChannel: first.channel })
    announcements.playbackError({ guildId: 'g2', error: new Error('boom'), cleanupAfterError: true, textChannel: second.channel })
    await settle()

    expect(first.sent).toEqual([MESSAGES.playbackError])
    expect(second.sent).toEqual([MESSAGES.playbackError])
  })
})
