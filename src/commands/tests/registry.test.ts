import type { JsonRecord } from '../../core/json.ts'
import type { QueueView } from '../../ports/music.ts'
import type { CommandSpec } from '../spec.ts'
import { describe, expect, test } from 'bun:test'
import { fakeContext, fakeMusic, silentLog as log, queueOf } from '../../tests/fixtures.ts'
import { commandBus } from '../bus.ts'
import { commands } from '../index.ts'

const bus = commandBus({ specs: commands, logger: log })

function spec(name: string): CommandSpec {
  const found = commands.find((command) => command.name === name)

  if (!found) {
    throw new Error(`Missing command: ${name}`)
  }

  return found
}

function parseRemove(text: string, queue: QueueView | null): JsonRecord | null {
  return (
    spec('remove').parse?.(
      text,
      fakeContext({ services: { music: fakeMusic({ view: () => queue }) } }),
    ) ?? null
  )
}

describe('command registry', () => {
  test('every command has a unique name, description and schema', () => {
    const names = commands.map((command) => command.name)

    expect(new Set(names).size).toBe(names.length)

    for (const command of commands) {
      expect(command.description.length).toBeGreaterThan(0)
      expect(typeof command.run).toBe('function')
    }

    for (const tool of bus.tools) {
      expect(tool.parameters.type).toBe('object')
    }
  })

  test('the model only sees the tools meant for it', () => {
    const names = bus.tools.map((tool) => tool.name)

    expect(names).toContain('add_songs')
    expect(names).toContain('set_persona')
    expect(names).toContain('set_channel')
    expect(names).not.toContain('query')
    expect(names).not.toContain('toggle')
    expect(names).not.toContain('seek')
    expect(names).toContain('queue')
  })

  test('the router sees the commands, not the internal tools', () => {
    const names = bus.routes.map((route) => route.name)

    expect(names).toContain('skip')
    expect(names).toContain('remove')
    expect(names).not.toContain('add_songs')
    expect(names).not.toContain('set_channel')
    expect(names).not.toContain('query')
    expect(names).not.toContain('toggle')
    expect(names).not.toContain('seek')
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
})
