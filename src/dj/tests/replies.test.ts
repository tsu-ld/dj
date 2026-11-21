import type { Logger } from '../../core/logger.ts'
import type { ConversationPort } from '../../ports/conversation.ts'
import type { TestClock } from '../../tests/fixtures.ts'
import { describe, expect, test } from 'bun:test'
import { ERROR_ANNOUNCE_MS } from '../../limits.ts'
import { MESSAGES } from '../../messages.ts'
import { captureLog, fakeSettings, fakeTextChannel, scriptedModel, settle, silentLog, testClock, textReply } from '../../tests/fixtures.ts'
import { djReplies } from '../replies.ts'
import { testMessage } from './support.ts'

const settingsPort = fakeSettings({ persona: 'un dj pirata' })
const settings = settingsPort.current()

function replier(model: ConversationPort | null, options: { logger?: Logger, clock?: TestClock } = {}): ReturnType<typeof djReplies> {
  return djReplies({
    model,
    logger: options.logger ?? silentLog,
    settings: settingsPort,
    clock: options.clock ?? testClock(),
  })
}

function nullReply(): ConversationPort {
  return scriptedModel([() => ({ text: null, toolCalls: [] })])
}

function playbackError(textChannel: ReturnType<typeof fakeTextChannel>['channel'] | null, guildId = 'g1') {
  return { guildId, songId: null, cleanupAfterError: true, textChannel }
}

describe('djReplies', () => {
  test('say rewrites the text in character and replies to the message', async () => {
    const channel = fakeTextChannel()
    const { message, replies } = testMessage(channel.channel)
    const model = scriptedModel([() => textReply('  argh, listo  ')])
    const port = replier(model)

    await port.say(message, settings, 'Done.')

    expect(replies).toEqual(['argh, listo'])
    expect(channel.typing.count).toBe(1)
    expect(model.requests[0]?.messages).toEqual([{ role: 'user', content: 'Done.' }])
    expect(model.requests[0]?.instructions).toContain('un dj pirata')
    expect(model.requests[0]?.timeoutMs).toBe(5_000)
    expect(model.requests[0]?.maxOutputTokens).toBe(200)
    expect(model.requests[0]?.sessionId).toBe('chan-1')
  })

  test('the rewrite request disables reasoning so it cannot time out thinking', async () => {
    const channel = fakeTextChannel()
    const { message } = testMessage(channel.channel)
    const model = scriptedModel([() => textReply('argh, listo')])
    const port = replier(model)

    await port.say(message, settings, 'Done.')

    expect(model.requests[0]?.reasoning).toBe('none')
  })

  test('say falls back to the plain text when the model fails', async () => {
    const channel = fakeTextChannel()
    const { message, replies } = testMessage(channel.channel)
    const logs = captureLog()
    const model = scriptedModel([() => {
      throw new Error('upstream exploded')
    }])
    const port = replier(model, { logger: logs.logger })

    await port.say(message, settings, 'I need permissions to join.')

    expect(replies).toEqual(['I need permissions to join.'])
    expect(logs.events).toContain('dj.rewrite_failed')
  })

  test('a playback error is announced to the channel in character', async () => {
    const channel = fakeTextChannel()
    const model = scriptedModel([() => textReply('se cortó el tema')])
    const port = replier(model)

    port.playbackError(playbackError(channel.channel))
    await settle()

    expect(channel.sent).toEqual(['se cortó el tema'])
    expect(channel.typing.count).toBe(1)
    expect(model.requests[0]?.messages).toEqual([{ role: 'user', content: MESSAGES.playbackError }])
    expect(model.requests[0]?.instructions).toContain('un dj pirata')
  })

  test('the announcement falls back to the plain text when the model fails', async () => {
    const channel = fakeTextChannel()
    const logs = captureLog()
    const model = scriptedModel([() => {
      throw new Error('upstream exploded')
    }])
    const port = replier(model, { logger: logs.logger })

    port.playbackError(playbackError(channel.channel))
    await settle()

    expect(channel.sent).toEqual([MESSAGES.playbackError])
    expect(logs.events).toContain('dj.rewrite_failed')
  })

  test('an empty rewrite falls back instead of sending nothing', async () => {
    const channel = fakeTextChannel()
    const model = scriptedModel([() => textReply('')])
    const port = replier(model)

    port.playbackError(playbackError(channel.channel))
    await settle()

    expect(channel.sent).toEqual([MESSAGES.playbackError])
  })

  test('a rewritten line is clamped to a Discord message', async () => {
    const channel = fakeTextChannel()
    const { message, replies } = testMessage(channel.channel)
    const model = scriptedModel([() => textReply('x'.repeat(2_500))])
    const port = replier(model)

    await port.say(message, settings, 'Done.')

    expect(replies[0]?.length).toBe(2_000)
  })

  test('a failed typing indicator does not stop the reply', async () => {
    const channel = fakeTextChannel({ failTyping: true })
    const { message, replies } = testMessage(channel.channel)
    const model = scriptedModel([() => textReply('listo')])
    const port = replier(model)

    await port.say(message, settings, 'Done.')

    expect(replies).toEqual(['listo'])
  })

  test('a failed typing indicator is logged', async () => {
    const channel = fakeTextChannel({ failTyping: true })
    const { message } = testMessage(channel.channel)
    const logs = captureLog()
    const model = scriptedModel([() => textReply('listo')])
    const port = replier(model, { logger: logs.logger })

    await port.say(message, settings, 'Done.')
    await settle()

    expect(logs.entries('dj.typing_failed')).toEqual([
      expect.objectContaining({ level: 'debug', error: 'typing failed' }),
    ])
  })

  test('a failed announcement is logged and does not throw', async () => {
    const channel = fakeTextChannel({ failSend: true })
    const logs = captureLog()
    const model = scriptedModel([() => textReply('listo')])
    const port = replier(model, { logger: logs.logger })

    port.playbackError(playbackError(channel.channel))
    await settle()

    expect(logs.events).toContain('dj.announce_failed')
  })

  test('without a model both the reply and the announcement send the plain text', async () => {
    const channel = fakeTextChannel()
    const { message, replies } = testMessage(channel.channel)
    const port = replier(null)

    await port.say(message, settings, 'Done.')
    port.playbackError(playbackError(channel.channel))
    await settle()

    expect(replies).toEqual(['Done.'])
    expect(channel.sent).toEqual([MESSAGES.playbackError])
    expect(channel.typing.count).toBe(0)
  })

  test('a playback error is announced once per thirty seconds', async () => {
    const channel = fakeTextChannel()
    const clock = testClock(1_000_000)
    const port = replier(nullReply(), { clock })
    const payload = { guildId: 'g1', songId: 'song-1', cleanupAfterError: true, textChannel: channel.channel }

    port.playbackError(payload)
    await settle()

    clock.advance(29_999)
    port.playbackError(payload)
    await settle()

    clock.advance(1)
    port.playbackError(payload)
    await settle()

    expect(channel.sent).toEqual([MESSAGES.playbackError, MESSAGES.playbackError])
  })

  test('the throttle slot is taken even when there is no channel', async () => {
    const channel = fakeTextChannel()
    const clock = testClock(1_000_000)
    const port = replier(nullReply(), { clock })

    port.playbackError(playbackError(null))
    await settle()

    clock.advance(1)
    port.playbackError(playbackError(channel.channel))
    await settle()

    expect(channel.sent).toEqual([])

    clock.advance(ERROR_ANNOUNCE_MS)
    port.playbackError(playbackError(channel.channel))
    await settle()

    expect(channel.sent).toEqual([MESSAGES.playbackError])
  })

  test('each guild has its own error throttle', async () => {
    const first = fakeTextChannel({ id: 'chan-1' })
    const second = fakeTextChannel({ id: 'chan-2' })
    const port = replier(nullReply(), { clock: testClock(1_000_000) })

    port.playbackError(playbackError(first.channel, 'g1'))
    port.playbackError(playbackError(second.channel, 'g2'))
    await settle()

    expect(first.sent).toEqual([MESSAGES.playbackError])
    expect(second.sent).toEqual([MESSAGES.playbackError])
  })
})
