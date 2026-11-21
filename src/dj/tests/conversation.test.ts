import type { CommandOutcome } from '../../commands/spec.ts'
import type { ConversationPort } from '../../ports/conversation.ts'
import { describe, expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.ts'
import {
  captureLog,
  fakeContext,
  fakeSettings,
  fakeTextChannel,
  scriptedModel,
  settle,
  silentLog,
  testClock,
  testView,
  textReply,
} from '../../tests/fixtures.ts'
import { djAgent } from '../conversation.ts'
import { call, failed, ok, refused, testBus, toolReply } from './support.ts'

function toolMessages(messages: readonly { role: string, content: string | null }[]): { role: string, content: string | null }[] {
  return messages.filter(message => message.role === 'tool')
}

function testAgent(model: ConversationPort, deps: Partial<Omit<Parameters<typeof djAgent>[0], 'model'>> = {}) {
  return djAgent({ model, bus: testBus(), settings: fakeSettings(), logger: silentLog, clock: testClock(), ...deps })
}

describe('djAgent', () => {
  test('a request without an author still answers through the channel history', async () => {
    const model = scriptedModel([() => textReply('hola')])
    const agent = testAgent(model)

    const reply = await agent.ask({ request: 'hola', context: fakeContext() })

    expect(reply).toBe('hola')
    expect(model.requests[0]?.messages).toEqual([{ role: 'user', content: 'hola' }])
    expect(model.requests[0]?.sessionId).toBe('chan-1')
    expect(model.requests[0]?.timeoutMs).toBe(40_000)
    expect(model.requests[0]?.instructions).toContain('You are the DJ of a Discord server')
  })

  test('the guild persona from the settings port reaches the prompt', async () => {
    const model = scriptedModel([() => textReply('hola')])
    const agent = testAgent(model, { settings: fakeSettings({ persona: 'un dj pirata' }) })

    await agent.ask({ request: 'hola', context: fakeContext() })

    expect(model.requests[0]?.instructions).toContain('un dj pirata')
  })

  test('a conversation keeps its context on the next request', async () => {
    const model = scriptedModel([() => textReply('hola'), () => textReply('otra vez')])
    const agent = testAgent(model)
    const context = fakeContext()

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
    const agent = testAgent(model, { bus })

    const reply = await agent.ask({ request: 'hacelo', context: fakeContext() })
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
    const agent = testAgent(model, { bus, clock })

    await expect(agent.ask({ request: 'hacelo', context: fakeContext() }))
      .rejects
      .toThrow(/ran out of time/)
    expect(bus.calls).toHaveLength(0)
  })

  test('the deadline after acting returns the short confirmation', async () => {
    const clock = testClock()
    const settings = fakeSettings()
    const model = scriptedModel([() => toolReply(call('call_1', 'set_persona', '{"persona":"un dj"}'))])
    const bus = testBus(async () => {
      await settings.update('123456789012345678', { persona: 'un dj' })
      clock.advance(60_001)

      return ok({ persona: 'un dj' })
    })
    const agent = testAgent(model, { bus, settings, clock })

    const reply = await agent.ask({ request: 'sé un dj', context: fakeContext() })

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
    const agent = testAgent(model, { bus, clock })
    const context = fakeContext()

    const reply = await agent.ask({ request: 'hacelo', context })

    expect(reply).toBe(MESSAGES.djActed)
    expect(bus.calls).toHaveLength(1)

    await agent.ask({ request: 'seguí', context })

    const results = toolMessages(model.requests[1]?.messages ?? [])

    expect(results.at(-1)?.content).toContain('the request ran out of time')
  })

  test('a refused or failed tool is reported to the caller, a successful one is not', async () => {
    const outcomes: Record<string, CommandOutcome> = { ok: ok(), refused: refused('no permission'), failed: failed(new Error('boom')) }
    const problems: string[] = []

    for (const name of ['ok', 'refused', 'failed']) {
      const agent = testAgent(scriptedModel([() => toolReply(call('call_1', name)), () => textReply('listo')]), { bus: testBus(() => outcomes[name] ?? ok()) })

      await agent.ask({ request: 'hacelo', context: fakeContext(), onRefused: () => problems.push(name) })
    }

    expect(problems).toEqual(['refused', 'failed'])
  })

  test('a tool stopped by the deadline, the call cap or malformed arguments is reported to the caller', async () => {
    const problems: string[] = []

    async function ask(name: string, reply: () => ReturnType<typeof toolReply>, clock = testClock()): Promise<void> {
      const agent = testAgent(scriptedModel([reply, () => textReply('listo')]), { clock })

      await agent.ask({ request: 'hacelo', context: fakeContext(), onRefused: () => problems.push(name) })
    }

    const clock = testClock()

    await expect(ask('deadline', () => {
      clock.advance(60_001)

      return toolReply(call('call_1', 'skip'))
    }, clock)).rejects.toThrow('The DJ ran out of time before answering.')
    await ask('cap', () => toolReply(...Array.from({ length: 5 }, (_, index) => call(`call_${index}`, 'skip'))))
    await ask('malformed', () => toolReply(call('call_1', 'skip', 'not json')))

    expect(problems).toEqual(['deadline', 'cap', 'malformed'])
  })

  test('tool outcomes keep the data, the refusal and the failure apart', async () => {
    const logs = captureLog()
    const model = scriptedModel([
      () => toolReply(
        call('call_1', 'with_data'),
        call('call_3', 'refused'),
        call('call_4', 'failed'),
      ),
      () => textReply('listo'),
    ])
    const bus = testBus((name) => {
      if (name === 'with_data')
        return ok({ queued: 2 })

      if (name === 'refused')
        return refused('no permission')

      return failed(new Error('boom'))
    })
    const agent = testAgent(model, { bus, logger: logs.logger })

    await agent.ask({ request: 'hacelo', context: fakeContext() })

    const results = toolMessages(model.requests[1]?.messages ?? [])

    expect(results.map(result => result.content)).toEqual([
      '{"queued":2}',
      '{"error":"no permission"}',
      '{"error":"the player could not do that"}',
    ])
    expect(logs.events).toContain('dj.tool_failed')
  })

  test('a tool that throws is reported to the model without breaking the turn', async () => {
    const logs = captureLog()
    const model = scriptedModel([() => toolReply(call('call_1', 'skip')), () => textReply('listo')])
    const bus = testBus(() => {
      throw new Error('player exploded')
    })
    const agent = testAgent(model, { bus, logger: logs.logger })

    const reply = await agent.ask({ request: 'hacelo', context: fakeContext() })
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
    const agent = testAgent(model, { bus })

    await agent.ask({ request: 'hacelo', context: fakeContext() })

    expect(bus.calls).toHaveLength(0)
    expect(toolMessages(model.requests[1]?.messages ?? [])[0]?.content)
      .toBe('{"error":"those arguments were not valid JSON"}')
  })

  test('nothing said and nothing acted returns null', async () => {
    const model = scriptedModel([() => textReply('')])
    const agent = testAgent(model)

    expect(await agent.ask({ request: 'hola', context: fakeContext() })).toBeNull()
  })

  test('acting without a final line returns the short confirmation', async () => {
    const model = scriptedModel([() => toolReply(call('call_1', 'skip')), () => textReply('')])
    const agent = testAgent(model)

    expect(await agent.ask({ request: 'skippea', context: fakeContext() }))
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
    const agent = testAgent(model, { bus })

    const reply = await agent.ask({ request: 'hacelo', context: fakeContext() })

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
    const agent = testAgent(model, { bus })

    const reply = await agent.ask({ request: 'hacelo', context: fakeContext() })
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
    const agent = testAgent(model)

    await expect(agent.ask({ request: 'hola', context: fakeContext() }))
      .rejects
      .toThrow('upstream exploded')
  })

  test('a failure after acting is confirmed and remembered without a dangling call', async () => {
    const logs = captureLog()
    const model = scriptedModel([
      () => toolReply(call('call_1', 'skip')),
      () => {
        throw new Error('upstream exploded')
      },
      () => textReply('hola'),
    ])
    const agent = testAgent(model, { logger: logs.logger })
    const context = fakeContext()

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
    const agent = testAgent(model, { bus })
    const base = fakeContext()
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
    const channel = fakeTextChannel()
    const model = scriptedModel([() => textReply('x'.repeat(2_500))])
    const agent = testAgent(model)

    const reply = await agent.ask({
      request: 'hola',
      context: fakeContext({ textChannel: channel.channel }),
    })

    expect(reply?.length).toBe(2_000)
    expect(channel.typing.count).toBe(1)
  })

  test('a failed typing indicator is logged and the DJ still answers', async () => {
    const channel = fakeTextChannel({ failTyping: true })
    const logs = captureLog()
    const model = scriptedModel([() => textReply('hola')])
    const agent = testAgent(model, { logger: logs.logger })

    const reply = await agent.ask({ request: 'hola', context: fakeContext({ textChannel: channel.channel }) })
    await settle()

    expect(reply).toBe('hola')
    expect(logs.entries('dj.typing_failed')).toEqual([
      expect.objectContaining({ level: 'debug', error: 'typing failed' }),
    ])
  })
})
