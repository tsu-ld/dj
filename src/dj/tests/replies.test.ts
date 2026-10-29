import type { ConversationPort } from '../../ports/conversation.ts'
import { describe, expect, test } from 'bun:test'
import { djReplies } from '../replies.ts'
import {
  captureLogger,
  scriptedModel,
  silentLogger,
  testChannel,
  testMessage,
  testSettings,
  textReply,
} from './support.ts'

const settings = testSettings({ persona: 'un dj pirata' }).current()

describe('djReplies', () => {
  test('say rewrites the text in character and replies to the message', async () => {
    const channel = testChannel()
    const { message, replies } = testMessage(channel.channel)
    const model = scriptedModel([() => textReply('  argh, listo  ')])
    const port = djReplies({ model, logger: silentLogger() })

    await port.say(message, settings, 'Done.')

    expect(replies).toEqual(['argh, listo'])
    expect(channel.typing.count).toBe(1)
    expect(model.requests[0]?.messages).toEqual([{ role: 'user', content: 'Done.' }])
    expect(model.requests[0]?.instructions).toContain('un dj pirata')
    expect(model.requests[0]?.timeoutMs).toBe(5_000)
    expect(model.requests[0]?.maxOutputTokens).toBe(200)
    expect(model.requests[0]?.sessionId).toBe('chan-1')
  })

  test('say falls back to the plain text when the model fails', async () => {
    const channel = testChannel()
    const { message, replies } = testMessage(channel.channel)
    const logs = captureLogger()
    const model = scriptedModel([() => {
      throw new Error('upstream exploded')
    }])
    const port = djReplies({ model, logger: logs.logger })

    await port.say(message, settings, 'I need permissions to join.')

    expect(replies).toEqual(['I need permissions to join.'])
    expect(logs.events).toContain('dj.rewrite_failed')
  })

  test('announce sends the rewritten line to the channel', async () => {
    const channel = testChannel()
    const model = scriptedModel([() => textReply('un tema nuevo')])
    const port = djReplies({ model, logger: silentLogger() })

    await port.announce(channel.channel, settings, 'Added "Tema" to the queue.')

    expect(channel.sent).toEqual(['un tema nuevo'])
    expect(channel.typing.count).toBe(1)
  })

  test('announce falls back to the plain text when the model fails', async () => {
    const channel = testChannel()
    const logs = captureLogger()
    const model = scriptedModel([() => {
      throw new Error('upstream exploded')
    }])
    const port = djReplies({ model, logger: logs.logger })

    await port.announce(channel.channel, settings, 'Added "Tema" to the queue.')

    expect(channel.sent).toEqual(['Added "Tema" to the queue.'])
    expect(logs.events).toContain('dj.rewrite_failed')
  })

  test('an empty rewrite falls back instead of sending nothing', async () => {
    const channel = testChannel()
    const model = scriptedModel([() => textReply('')])
    const port = djReplies({ model, logger: silentLogger() })

    await port.announce(channel.channel, settings, 'Added "Tema" to the queue.')

    expect(channel.sent).toEqual(['Added "Tema" to the queue.'])
  })

  test('a rewritten line is clamped to a Discord message', async () => {
    const channel = testChannel()
    const { message, replies } = testMessage(channel.channel)
    const model = scriptedModel([() => textReply('x'.repeat(2_500))])
    const port = djReplies({ model, logger: silentLogger() })

    await port.say(message, settings, 'Done.')

    expect(replies[0]?.length).toBe(2_000)
  })

  test('a failed typing indicator does not stop the reply', async () => {
    const channel = testChannel({ failTyping: true })
    const { message, replies } = testMessage(channel.channel)
    const model = scriptedModel([() => textReply('listo')])
    const port = djReplies({ model, logger: silentLogger() })

    await port.say(message, settings, 'Done.')

    expect(replies).toEqual(['listo'])
  })

  test('a failed announcement is logged and does not throw', async () => {
    const channel = testChannel({ failSend: true })
    const logs = captureLogger()
    const model = scriptedModel([() => textReply('listo')])
    const port = djReplies({ model, logger: logs.logger })

    await port.announce(channel.channel, settings, 'Added "Tema" to the queue.')

    expect(logs.events).toContain('dj.announce_failed')
  })

  test('without a model both methods send the plain text', async () => {
    const channel = testChannel()
    const { message, replies } = testMessage(channel.channel)
    const port = djReplies({ model: null, logger: silentLogger() })

    await port.say(message, settings, 'Done.')
    await port.announce(channel.channel, settings, 'Added "Tema" to the queue.')

    expect(replies).toEqual(['Done.'])
    expect(channel.sent).toEqual(['Added "Tema" to the queue.'])
    expect(channel.typing.count).toBe(0)
  })

  test('there is no refuse alias', () => {
    const model: ConversationPort = scriptedModel([() => textReply('listo')])
    const port = djReplies({ model, logger: silentLogger() })

    expect(Object.keys(port).sort()).toEqual(['announce', 'say'])
  })
})
