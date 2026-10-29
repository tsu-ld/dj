import { describe, expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.ts'
import { commandBus } from '../bus.ts'
import { commands } from '../index.ts'
import { fakeContext, fakeMusic, fakeUi, log, track, view } from './fakes.ts'

describe('queue commands', () => {
  test('queue shows the live queue and never reacts', async () => {
    const fresh = view({ current: track({ title: 'Ahora' }), size: 2, upcoming: [track({ id: '2', title: 'Después' })] })
    const ui = fakeUi()
    const music = fakeMusic({ view: () => fresh })
    const bus = commandBus({ specs: commands, logger: log })

    const outcome = await bus.run('queue', {}, fakeContext({ ui, services: { music }, queue: null }))

    expect(outcome).toEqual({ kind: 'ok', data: {} })
    expect(ui.queues).toEqual([fresh])
    expect(ui.acks()).toBe(0)
  })

  test('remove takes a valid position from the live queue', async () => {
    const positions: number[] = []
    const music = fakeMusic({
      view: () => view({ size: 3 }),
      async remove(_guildId, position) {
        positions.push(position)

        return 'Segunda'
      },
    })
    const bus = commandBus({ specs: commands, logger: log })

    const outcome = await bus.run('remove', { position: 2 }, fakeContext({ services: { music } }))

    expect(outcome).toEqual({ kind: 'ok', data: { removed: 'Segunda' } })
    expect(positions).toEqual([2])
  })

  test('remove refuses a position outside the queue', async () => {
    const music = fakeMusic({ view: () => view({ size: 3 }) })
    const bus = commandBus({ specs: commands, logger: log })

    for (const position of [0, 9, 2.5]) {
      const outcome = await bus.run('remove', { position }, fakeContext({ services: { music }, queue: view({ size: 3 }) }))

      expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.removeOutOfRange })
    }

    expect(music.calls).not.toContain('remove')
  })

  test('clear stops the music and resets the station', async () => {
    const calls: [string, { resetStation?: boolean } | undefined][] = []
    const music = fakeMusic({
      view: () => view(),
      async stop(guildId, options) {
        calls.push([guildId, options])
      },
    })
    const ui = fakeUi()
    const bus = commandBus({ specs: commands, logger: log })
    const context = fakeContext({ guildId: 'g1', ui, services: { music } })

    const outcome = await bus.run('clear', {}, context)

    expect(outcome).toEqual({ kind: 'ok', data: { cleared: true } })
    expect(calls).toEqual([['g1', { resetStation: true }]])
    expect(ui.acks()).toBe(1)
  })

  test('queue refuses without a live queue', async () => {
    const bus = commandBus({ specs: commands, logger: log })

    const outcome = await bus.run('queue', {}, fakeContext())

    expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.nothingPlaying })
  })
})
