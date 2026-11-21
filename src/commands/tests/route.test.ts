import { describe, expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.ts'
import { fakeContext, fakeMusic, fakeUi, silentLog as log, testTrack as track, testView as view } from '../../tests/fixtures.ts'
import { commandBus } from '../bus.ts'
import { commands } from '../index.ts'
import { chooseRoute } from '../route.ts'

const queue = view({
  current: track({ title: 'a' }),
  upcoming: [track({ id: 'track-2', title: 'b' })],
  size: 2,
})

const withQueue = fakeContext({ services: { music: fakeMusic({ view: () => queue }) } })
const bus = commandBus({ specs: commands, logger: log })

describe('chooseRoute', () => {
  test('a route command with no arguments runs', () => {
    const route = chooseRoute(bus, 'pausá', 'pause', withQueue)

    expect(route?.spec.name).toBe('pause')
    expect(route?.args).toEqual({})
  })

  test('a queue command without a queue routes so the bus refuses it once', async () => {
    for (const [text, name] of [['pausá', 'pause'], ['remove 1', 'remove']] as const) {
      const ui = fakeUi()
      const context = fakeContext({ ui })
      const route = chooseRoute(bus, text, name, context)

      expect(route?.spec.name).toBe(name)

      if (route)
        await bus.run(route.spec.name, route.args, context)

      expect(ui.errors).toEqual([MESSAGES.nothingPlaying])
    }
  })

  test('remove needs a valid position or the dj infers it', () => {
    const argsOf = (text: string): unknown => {
      const route = chooseRoute(bus, text, 'remove', withQueue)

      return route?.args ?? null
    }

    expect(argsOf('remove 2')).toEqual({ position: 2 })
    expect(argsOf('remove 2.5')).toBeNull()
    expect(argsOf('remove 9')).toBeNull()
    expect(argsOf('remove the third')).toBeNull()
  })

  test('internal or unknown commands never route directly', () => {
    expect(chooseRoute(bus, 'sé un dj', 'set_persona', withQueue)).toBeNull()
    expect(chooseRoute(bus, 'usa esto', 'query', withQueue)).toBeNull()
    expect(chooseRoute(bus, 'hola', 'nope', withQueue)).toBeNull()
    expect(chooseRoute(bus, 'hola', 'dj', withQueue)).toBeNull()
  })
})
