import type { Logger } from '../../core/logger.ts'
import type { CommandSpec } from '../spec.ts'
import { describe, expect, test } from 'bun:test'
import { UserError } from '../../core/errors.ts'
import { MESSAGES } from '../../messages.ts'
import { commandBus } from '../bus.ts'
import { EMPTY_PARAMETERS } from '../parameters.ts'
import { fakeContext, fakeMusic, fakeUi, log, view } from './fakes.ts'

function command(overrides: Partial<CommandSpec> & Pick<CommandSpec, 'name' | 'run'>): CommandSpec {
  return { description: overrides.name, parameters: EMPTY_PARAMETERS, ...overrides }
}

function recordingLogger(): { logger: Logger, errors: string[] } {
  const errors: string[] = []
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error(event, error) {
      errors.push(`${event}:${error instanceof Error ? error.message : String(error)}`)
    },
    child: () => logger,
  }

  return { logger, errors }
}

describe('commandBus', () => {
  test('runs a command and acknowledges it', async () => {
    const ui = fakeUi()
    let ran = 0
    const bus = commandBus({
      specs: [command({ name: 'thing', async run() {
        ran++

        return { done: true }
      } })],
      logger: log,
    })

    const outcome = await bus.run('thing', {}, fakeContext({ ui }))

    expect(outcome).toEqual({ kind: 'ok', data: { done: true } })
    expect(ran).toBe(1)
    expect(ui.acks()).toBe(1)
    expect(ui.replies).toEqual([])
  })

  test('a confirmation wins over the ack', async () => {
    const ui = fakeUi()
    const bus = commandBus({
      specs: [command({ name: 'thing', async run() { return { saved: true } }, confirm: () => 'Saved.' })],
      logger: log,
    })

    await bus.run('thing', {}, fakeContext({ ui }))

    expect(ui.replies).toEqual(['Saved.'])
    expect(ui.acks()).toBe(0)
  })

  test('ack false never reacts, and a null confirmation falls back to the ack', async () => {
    const quiet = fakeUi()
    const silent = commandBus({
      specs: [command({ name: 'thing', ack: false, async run() { return {} } })],
      logger: log,
    })

    await silent.run('thing', {}, fakeContext({ ui: quiet }))
    expect(quiet.acks()).toBe(0)

    const loud = fakeUi()
    const fallback = commandBus({
      specs: [command({ name: 'thing', async run() { return {} }, confirm: () => null })],
      logger: log,
    })

    await fallback.run('thing', {}, fakeContext({ ui: loud }))
    expect(loud.acks()).toBe(1)
  })

  test('authorization refuses with the user error and never runs the command', async () => {
    const ui = fakeUi()
    let ran = false
    const bus = commandBus({
      specs: [command({
        name: 'thing',
        authorize() {
          throw new UserError('You may not.')
        },
        async run() {
          ran = true

          return {}
        },
      })],
      logger: log,
    })

    const outcome = await bus.run('thing', {}, fakeContext({ ui }))

    expect(outcome).toEqual({ kind: 'refused', message: 'You may not.' })
    expect(ran).toBe(false)
    expect(ui.errors).toEqual(['You may not.'])
  })

  test('a user error from the command is refused with its message', async () => {
    const ui = fakeUi()
    const bus = commandBus({
      specs: [command({
        name: 'thing',
        async run() {
          throw new UserError(MESSAGES.removeOutOfRange)
        },
      })],
      logger: log,
    })

    const outcome = await bus.run('thing', {}, fakeContext({ ui }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.removeOutOfRange })
    expect(ui.errors).toEqual([MESSAGES.removeOutOfRange])
  })

  test('an unexpected error is logged and surfaces the generic message', async () => {
    const ui = fakeUi()
    const recording = recordingLogger()
    const failure = new Error('provider exploded')
    const bus = commandBus({
      specs: [command({
        name: 'thing',
        async run() {
          throw failure
        },
      })],
      logger: recording.logger,
    })

    const outcome = await bus.run('thing', {}, fakeContext({ ui }))

    expect(outcome).toEqual({ kind: 'failed', error: failure })
    expect(ui.errors).toEqual([MESSAGES.genericError])
    expect(recording.errors).toEqual(['command.failed:provider exploded'])
    expect(ui.replies).toEqual([])
    expect(ui.acks()).toBe(0)
  })

  test('a queue command with no live queue is refused before authorization or side effects', async () => {
    const ui = fakeUi()
    let authorized = false
    let ran = false
    const bus = commandBus({
      specs: [command({
        name: 'thing',
        requiresQueue: true,
        authorize() {
          authorized = true
        },
        async run() {
          ran = true

          return {}
        },
      })],
      logger: log,
    })

    const context = fakeContext({ ui })

    expect(context.services.music.view(context.guildId)).toBeNull()

    const outcome = await bus.run('thing', {}, context)

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.nothingPlaying })
    expect(ui.errors).toEqual([MESSAGES.nothingPlaying])
    expect(authorized).toBe(false)
    expect(ran).toBe(false)
  })

  test('a voice command without a voice channel is refused', async () => {
    const ui = fakeUi()
    let ran = false
    const bus = commandBus({
      specs: [command({
        name: 'thing',
        requiresVoice: true,
        async run() {
          ran = true

          return {}
        },
      })],
      logger: log,
    })

    const outcome = await bus.run('thing', {}, fakeContext({ ui, voiceChannel: null }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.joinVoiceChannel })
    expect(ui.errors).toEqual([MESSAGES.joinVoiceChannel])
    expect(ran).toBe(false)
  })

  test('a queue command reads the live queue, not the context snapshot', async () => {
    const fresh = view({ size: 4 })
    const context = fakeContext({
      queue: null,
      services: { music: fakeMusic({ view: () => fresh }) },
    })
    const received: unknown[] = []
    const bus = commandBus({
      specs: [command({
        name: 'thing',
        requiresQueue: true,
        async run(_args, scoped) {
          received.push(scoped.queue)

          return {}
        },
      })],
      logger: log,
    })

    await bus.run('thing', {}, context)

    expect(received).toEqual([fresh])
    expect(context.queue).toBeNull()
  })

  test('tools and routes are derived from the spec flags', () => {
    const bus = commandBus({
      specs: [
        command({ name: 'both', async run() { return {} } }),
        command({ name: 'neither', modelTool: false, fastRoute: false, async run() { return {} } }),
        command({ name: 'tool', fastRoute: false, async run() { return {} } }),
      ],
      logger: log,
    })

    expect(bus.tools.map(tool => tool.name)).toEqual(['both', 'tool'])
    expect(bus.routes.map(route => route.name)).toEqual(['both'])
    expect(bus.specs).toHaveLength(3)
  })

  test('the model cannot execute a command that is not a tool', async () => {
    const ui = fakeUi()
    let ran = 0
    const bus = commandBus({
      specs: [command({
        name: 'internal',
        modelTool: false,
        async run() {
          ran++

          return {}
        },
      })],
      logger: log,
    })

    const outcome = await bus.runTool('internal', {}, fakeContext({ ui }))

    expect(ran).toBe(0)
    expect(outcome).toMatchObject({ kind: 'failed', message: 'there is no tool called internal' })
    expect(ui.errors).toEqual([])
  })

  test('the model can execute a command that is a tool', async () => {
    let ran = 0
    const bus = commandBus({
      specs: [command({
        name: 'public',
        async run() {
          ran++

          return { done: true }
        },
      })],
      logger: log,
    })

    const outcome = await bus.runTool('public', {}, fakeContext())

    expect(ran).toBe(1)
    expect(outcome.kind).toBe('ok')
  })

  test('a tool call still runs the command authorization', async () => {
    const ui = fakeUi()
    let ran = 0
    const bus = commandBus({
      specs: [command({
        name: 'guarded',
        authorize() {
          throw new UserError('nope')
        },
        async run() {
          ran++

          return {}
        },
      })],
      logger: log,
    })

    const outcome = await bus.runTool('guarded', {}, fakeContext({ ui }))

    expect(ran).toBe(0)
    expect(outcome).toEqual({ kind: 'refused', message: 'nope' })
    expect(ui.errors).toEqual(['nope'])
  })

  test('an unknown command fails without bothering the user', async () => {
    const ui = fakeUi()
    const bus = commandBus({ specs: [], logger: log })

    const outcome = await bus.run('nope', {}, fakeContext({ ui }))

    expect(outcome.kind).toBe('failed')
    expect(ui.errors).toEqual([])
  })
})
