import type { QueueView } from '../../ports/music.ts'
import type { CommandSpec } from '../spec.ts'
import { describe, expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.ts'
import { commandBus } from '../bus.ts'
import { commands } from '../index.ts'
import { fakeContext, fakeMember, fakeMessage, fakeMusic, fakeSettings, log, track, view } from './fakes.ts'

const bus = commandBus({ specs: commands, logger: log })

function spec(name: string): CommandSpec {
  const found = commands.find(command => command.name === name)

  if (!found)
    throw new Error(`Missing command: ${name}`)

  return found
}

function queueOf(count: number): QueueView {
  return view({
    current: track({ title: 'a' }),
    upcoming: Array.from({ length: count - 1 }, (_, index) => track({ id: `track-${index + 2}`, title: `Song ${index + 2}` })),
    size: count,
  })
}

function parseRemove(text: string, queue: QueueView | null): Record<string, unknown> | null {
  return spec('remove').parse?.(text, fakeContext({ queue })) ?? null
}

describe('command registry', () => {
  test('every command has a unique name, description and schema', () => {
    const names = commands.map(command => command.name)

    expect(new Set(names).size).toBe(names.length)

    for (const command of commands) {
      expect(command.description.length).toBeGreaterThan(0)
      expect(command.parameters.type).toBe('object')
      expect(typeof command.run).toBe('function')
    }
  })

  test('the model only sees the tools meant for it', () => {
    const names = bus.tools.map(tool => tool.name)

    expect(names).toContain('add_songs')
    expect(names).toContain('set_persona')
    expect(names).toContain('set_channel')
    expect(names).not.toContain('query')
    expect(names).not.toContain('toggle')
    expect(names).toContain('queue')
  })

  test('the router sees the commands, not the internal tools', () => {
    const names = bus.routes.map(route => route.name)

    expect(names).toContain('skip')
    expect(names).toContain('remove')
    expect(names).not.toContain('add_songs')
    expect(names).not.toContain('set_channel')
    expect(names).not.toContain('query')
    expect(names).not.toContain('toggle')
  })

  test('commands are looked up by name without a command switch', () => {
    expect(commands.find(command => command.name === 'skip')?.name).toBe('skip')
    expect(commands.find(command => command.name === 'nope')).toBeUndefined()
  })

  test('remove takes a valid queue position, or asks the dj', () => {
    const queue = queueOf(3)

    expect(parseRemove('remove 3', queue)).toEqual({ position: 3 })
    expect(parseRemove('sacá la 2', queue)).toEqual({ position: 2 })
    expect(parseRemove('remove 8', queue)).toBeNull()
    expect(parseRemove('sacá la tercera', queue)).toBeNull()
    expect(parseRemove('remove it', queue)).toBeNull()
  })

  test('admin commands are dj tools, not fast-path routes', () => {
    for (const name of ['set_persona', 'set_channel']) {
      const command = spec(name)

      expect(command.modelTool).not.toBe(false)
      expect(command.fastRoute).toBe(false)
    }
  })

  test('admin commands reject members without the permission', async () => {
    const member = fakeMember({ allowed: false })
    const settings = fakeSettings()

    const persona = await bus.run('set_persona', { persona: 'x' }, fakeContext({ member, services: { settings } }))
    const channel = await bus.run('set_channel', { channelId: '123' }, fakeContext({ member, services: { settings } }))

    expect(persona).toEqual({ kind: 'refused', message: MESSAGES.personaPermission })
    expect(channel).toEqual({ kind: 'refused', message: MESSAGES.channelConfigurePermission })
  })

  test('set_persona stores a trimmed persona for a manager', async () => {
    const settings = fakeSettings()

    const outcome = await bus.run('set_persona', { persona: '  un dj  ' }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: fakeMessage({ content: '<@999> sé un dj' }),
      services: { settings },
    }))

    expect(outcome).toEqual({ kind: 'ok', data: { persona: 'un dj' } })
    expect(settings.updates).toEqual([['g1', { persona: 'un dj' }]])
  })

  test('set_channel uses the mentioned channel and ignores the model argument', async () => {
    const settings = fakeSettings()
    const channel = { id: '456', name: 'music', isTextBased: () => true, isThread: () => false, permissionsFor: () => ({ has: () => true }) }

    const outcome = await bus.run('set_channel', { channelId: '<#456>' }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: fakeMessage({ content: '<@999> escuchá en <#456>', channels: [{ id: '456' }], fetchChannel: () => channel }),
      services: { settings },
    }))

    expect(outcome).toEqual({ kind: 'ok', data: { channelId: '456', channelName: 'music' } })
    expect(settings.updates).toEqual([['g1', { textChannelId: '456' }]])
  })

  test('player commands read the queue from the context, not the arguments', async () => {
    const calls: string[] = []
    let paused = false
    const music = fakeMusic({
      async pause() {
        paused = true
        calls.push('pause')
      },
      async resume() {
        paused = false
        calls.push('resume')
      },
      async toggle() {
        paused = !paused
        calls.push('toggle')

        return paused
      },
      async skip() {
        calls.push('skip')
      },
      async shuffle() {
        calls.push('shuffle')
      },
      async radio() {
        calls.push('radio')

        return true
      },
      async stop() {
        calls.push('stop')
      },
    })
    const context = (): ReturnType<typeof fakeContext> => fakeContext({ services: { music }, queue: view({ paused }) })

    await spec('pause').run({}, context())
    expect(paused).toBe(true)

    await spec('resume').run({}, context())
    expect(paused).toBe(false)

    await spec('toggle').run({}, context())
    expect(paused).toBe(true)

    await spec('skip').run({}, context())
    await spec('shuffle').run({}, context())
    await spec('radio').run({}, context())
    await spec('clear').run({}, context())

    expect(calls).toEqual(['pause', 'resume', 'toggle', 'skip', 'shuffle', 'radio', 'stop'])
  })

  test('set_channel rejects a mentioned channel that cannot be used', async () => {
    const outcome = await bus.run('set_channel', { channelId: '456' }, fakeContext({
      guildId: 'g1',
      member: fakeMember(),
      message: fakeMessage({ content: '<@999> escuchá en <#456>', channels: [{ id: '456' }], fetchChannel: () => null }),
    }))

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.textChannelInvalid })
  })
})
