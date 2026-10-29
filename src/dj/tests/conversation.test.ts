import type { MusicPort } from '../../ports/music.ts'
import { describe, expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.ts'
import { djAgent } from '../conversation.ts'
import {
  call,
  captureLogger,
  failed,
  ok,
  refused,
  scriptedModel,
  silentLogger,
  testBus,
  testChannel,
  testClock,
  testContext,
  testSettings,
  testView,
  textReply,
  toolReply,
} from './support.ts'

function toolMessages(messages: readonly { role: string, content: string | null }[]): { role: string, content: string | null }[] {
  return messages.filter(message => message.role === 'tool')
}

describe('djAgent', () => {
  test('a request without an author still answers through the channel history', async () => {
    const model = scriptedModel([() => textReply('hola')])
    const agent = djAgent({
      model,
      bus: testBus(),
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    const reply = await agent.ask({ request: 'hola', context: testContext({ message: null }) })

    expect(reply).toBe('hola')
    expect(model.requests[0]?.messages).toEqual([{ role: 'user', content: 'hola' }])
    expect(model.requests[0]?.sessionId).toBe('chan-1')
    expect(model.requests[0]?.timeoutMs).toBe(40_000)
    expect(model.requests[0]?.instructions).toContain('You are the DJ of a Discord server')
  })

  test('the guild persona from the settings port reaches the prompt', async () => {
    const model = scriptedModel([() => textReply('hola')])
    const agent = djAgent({
      model,
      bus: testBus(),
      settings: testSettings({ persona: 'un dj pirata' }),
      logger: silentLogger(),
      clock: testClock(),
    })

    await agent.ask({ request: 'hola', context: testContext({ message: null }) })

    expect(model.requests[0]?.instructions).toContain('un dj pirata')
  })

  test('a conversation keeps its context on the next request', async () => {
    const model = scriptedModel([() => textReply('hola'), () => textReply('otra vez')])
    const agent = djAgent({
      model,
      bus: testBus(),
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })
    const context = testContext({ message: null })

    await agent.ask({ request: 'hola', context })
    await agent.ask({ request: 'qué suena', context })

    expect(model.requests[1]?.messages).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'hola' },
      { role: 'user', content: 'qué suena' },
    ])
  })

  test('tool calls over the per-round cap still get a result', async () => {
    const calls = Array.from({ length: 5 }, (_, index) => call(`call_${index}`, 'nope'))
    const model = scriptedModel([() => toolReply(...calls), () => textReply('listo')])
    const bus = testBus(() => refused('there is no tool called nope'))
    const agent = djAgent({
      model,
      bus,
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    const reply = await agent.ask({ request: 'hacelo', context: testContext({ message: null }) })
    const results = toolMessages(model.requests[1]?.messages ?? [])

    expect(reply).toBe('listo')
    expect(results).toHaveLength(5)
    expect(results.at(-1)?.content).toContain('too many tool calls')
    expect(bus.calls).toHaveLength(4)
  })

  test('the deadline stops tool rounds and throws when nothing happened', async () => {
    const clock = testClock()
    const model = scriptedModel([() => {
      clock.advance(60_001)

      return toolReply(call('call_1', 'skip'))
    }])
    const bus = testBus()
    const agent = djAgent({
      model,
      bus,
      settings: testSettings(),
      logger: silentLogger(),
      clock,
    })

    await expect(agent.ask({ request: 'hacelo', context: testContext({ message: null }) }))
      .rejects
      .toThrow(/ran out of time/)
    expect(bus.calls).toHaveLength(0)
  })

  test('the deadline after acting returns the short confirmation', async () => {
    const clock = testClock()
    const settings = testSettings()
    const model = scriptedModel([() => toolReply(call('call_1', 'set_persona', '{"persona":"un dj"}'))])
    const bus = testBus(async () => {
      await settings.update('123456789012345678', { persona: 'un dj' })
      clock.advance(60_001)

      return ok({ persona: 'un dj' })
    })
    const agent = djAgent({
      model,
      bus,
      settings,
      logger: silentLogger(),
      clock,
    })

    const reply = await agent.ask({ request: 'sé un dj', context: testContext({ message: null }) })

    expect(reply).toBe(MESSAGES.djActed)
    expect(settings.current()).toEqual({ textChannelId: null, persona: 'un dj' })
  })

  test('a deadline that hits between two tool calls skips the second one', async () => {
    const clock = testClock()
    const model = scriptedModel([() => toolReply(call('call_1', 'skip'), call('call_2', 'skip')), () => textReply('ok')])
    const bus = testBus(() => {
      clock.advance(60_001)

      return ok()
    })
    const agent = djAgent({
      model,
      bus,
      settings: testSettings(),
      logger: silentLogger(),
      clock,
    })
    const context = testContext({ message: null })

    const reply = await agent.ask({ request: 'hacelo', context })

    expect(reply).toBe(MESSAGES.djActed)
    expect(bus.calls).toHaveLength(1)

    await agent.ask({ request: 'seguí', context })

    const results = toolMessages(model.requests[1]?.messages ?? [])

    expect(results.at(-1)?.content).toContain('the request ran out of time')
  })

  test('tool outcomes keep the data, the refusal and the failure apart', async () => {
    const logs = captureLogger()
    const model = scriptedModel([
      () => toolReply(
        call('call_1', 'with_data'),
        call('call_2', 'without_data'),
        call('call_3', 'refused'),
        call('call_4', 'failed'),
      ),
      () => textReply('listo'),
    ])
    const bus = testBus((name) => {
      if (name === 'with_data')
        return ok({ queued: 2 })

      if (name === 'without_data')
        return ok()

      if (name === 'refused')
        return refused('no permission')

      return failed(new Error('boom'))
    })
    const agent = djAgent({
      model,
      bus,
      settings: testSettings(),
      logger: logs.logger,
      clock: testClock(),
    })

    await agent.ask({ request: 'hacelo', context: testContext({ message: null }) })

    const results = toolMessages(model.requests[1]?.messages ?? [])

    expect(results.map(result => result.content)).toEqual([
      '{"queued":2}',
      '{"done":"without_data"}',
      '{"error":"no permission"}',
      '{"error":"the player could not do that"}',
    ])
    expect(logs.events).toContain('dj.tool_failed')
  })

  test('a tool that throws is reported to the model without breaking the turn', async () => {
    const logs = captureLogger()
    const model = scriptedModel([() => toolReply(call('call_1', 'skip')), () => textReply('listo')])
    const bus = testBus(() => {
      throw new Error('player exploded')
    })
    const agent = djAgent({
      model,
      bus,
      settings: testSettings(),
      logger: logs.logger,
      clock: testClock(),
    })

    const reply = await agent.ask({ request: 'hacelo', context: testContext({ message: null }) })
    const results = toolMessages(model.requests[1]?.messages ?? [])

    expect(reply).toBe('listo')
    expect(results[0]?.content).toBe('{"error":"the player could not do that"}')
    expect(logs.events).toContain('dj.tool_failed')
  })

  test('invalid tool arguments never reach the bus', async () => {
    const model = scriptedModel([
      () => toolReply(call('call_1', 'skip', '{not json')),
      () => textReply('listo'),
    ])
    const bus = testBus()
    const agent = djAgent({
      model,
      bus,
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    await agent.ask({ request: 'hacelo', context: testContext({ message: null }) })

    expect(bus.calls).toHaveLength(0)
    expect(toolMessages(model.requests[1]?.messages ?? [])[0]?.content)
      .toBe('{"error":"those arguments were not valid JSON"}')
  })

  test('nothing said and nothing acted returns null', async () => {
    const model = scriptedModel([() => textReply('')])
    const agent = djAgent({
      model,
      bus: testBus(),
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    expect(await agent.ask({ request: 'hola', context: testContext({ message: null }) })).toBeNull()
  })

  test('acting without a final line returns the short confirmation', async () => {
    const model = scriptedModel([() => toolReply(call('call_1', 'skip')), () => textReply('')])
    const agent = djAgent({
      model,
      bus: testBus(),
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    expect(await agent.ask({ request: 'skippea', context: testContext({ message: null }) }))
      .toBe(MESSAGES.djActed)
  })

  test('the closing call is tool-free', async () => {
    const bus = testBus()
    const model = scriptedModel([
      () => toolReply(call('call_1', 'skip')),
      () => toolReply(call('call_2', 'skip')),
      () => toolReply(call('call_3', 'skip')),
      () => textReply('final'),
    ])
    const agent = djAgent({
      model,
      bus,
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    const reply = await agent.ask({ request: 'hacelo', context: testContext({ message: null }) })

    expect(reply).toBe('final')
    expect(model.requests).toHaveLength(4)
    expect(model.requests[0]?.tools).toEqual(bus.tools)
    expect(model.requests[3]?.tools).toBeUndefined()
    expect(bus.calls).toHaveLength(3)
  })

  test('at most eight tools run across three rounds', async () => {
    const fourCalls = [
      call('a', 'skip'),
      call('b', 'skip'),
      call('c', 'skip'),
      call('d', 'skip'),
    ]
    const model = scriptedModel([
      () => toolReply(...fourCalls),
      () => toolReply(...fourCalls),
      () => toolReply(...fourCalls),
      () => textReply('ok'),
    ])
    const bus = testBus()
    const agent = djAgent({
      model,
      bus,
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    const reply = await agent.ask({ request: 'hacelo', context: testContext({ message: null }) })
    const capped = toolMessages(model.requests[3]?.messages ?? [])
      .filter(result => result.content === '{"error":"too many tool calls; try fewer at once"}')

    expect(reply).toBe('ok')
    expect(bus.calls).toHaveLength(8)
    expect(capped).toHaveLength(4)
  })

  test('a failure before acting is thrown to the caller', async () => {
    const model = scriptedModel([() => {
      throw new Error('upstream exploded')
    }])
    const agent = djAgent({
      model,
      bus: testBus(),
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    await expect(agent.ask({ request: 'hola', context: testContext({ message: null }) }))
      .rejects
      .toThrow('upstream exploded')
  })

  test('a failure after acting is confirmed and remembered without a dangling call', async () => {
    const logs = captureLogger()
    const model = scriptedModel([
      () => toolReply(call('call_1', 'skip')),
      () => {
        throw new Error('upstream exploded')
      },
      () => textReply('hola'),
    ])
    const agent = djAgent({
      model,
      bus: testBus(),
      settings: testSettings(),
      logger: logs.logger,
      clock: testClock(),
    })
    const context = testContext({ message: null })

    expect(await agent.ask({ request: 'skippea', context })).toBe(MESSAGES.djActed)
    expect(await agent.ask({ request: 'hola', context })).toBe('hola')

    expect(logs.events).toContain('dj.failed_after_acting')
    expect(model.requests[2]?.messages.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'user',
    ])
  })

  test('every tool sees the queue as it is at that moment', async () => {
    let view = testView({ size: 1 })
    const music = { view: () => view } as unknown as MusicPort
    const sizes: number[] = []
    const bus = testBus((name, _args, context) => {
      sizes.push(context.queue?.size ?? 0)

      if (name === 'add_songs')
        view = testView({ size: 5 })

      return ok()
    })
    const model = scriptedModel([
      () => toolReply(call('call_1', 'add_songs'), call('call_2', 'add_songs')),
      () => textReply('listo'),
    ])
    const agent = djAgent({
      model,
      bus,
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    await agent.ask({ request: 'poné dos temas', context: testContext({ message: null, music }) })

    expect(sizes).toEqual([1, 5])
  })

  test('a tool call does not ack or confirm through the command ui', async () => {
    const seen: string[] = []
    const model = scriptedModel([() => toolReply(call('call_1', 'set_channel')), () => textReply('listo')])
    const bus = testBus(async (_name, _args, context) => {
      await context.ui.reply('confirmed')
      await context.ui.ack()
      await context.ui.error('nope')
      await context.ui.showQueue(testView())

      return ok()
    })
    const agent = djAgent({
      model,
      bus,
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })
    const base = testContext({ message: null })
    const context = {
      ...base,
      ui: {
        reply: async () => {
          seen.push('reply')
        },
        error: async () => {
          seen.push('error')
        },
        ack: async () => {
          seen.push('ack')
        },
        showQueue: async () => {
          seen.push('queue')
        },
      },
    }

    expect(await agent.ask({ request: 'configurá el canal', context })).toBe('listo')
    expect(seen).toEqual(['queue'])
  })

  test('the answer is clamped to a Discord message', async () => {
    const channel = testChannel()
    const model = scriptedModel([() => textReply('x'.repeat(2_500))])
    const agent = djAgent({
      model,
      bus: testBus(),
      settings: testSettings(),
      logger: silentLogger(),
      clock: testClock(),
    })

    const reply = await agent.ask({
      request: 'hola',
      context: testContext({ channel: channel.channel, message: null }),
    })

    expect(reply?.length).toBe(2_000)
    expect(channel.typing.count).toBe(1)
  })
})
