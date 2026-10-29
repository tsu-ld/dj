import { describe, expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.ts'
import { commandBus } from '../bus.ts'
import { commands } from '../index.ts'
import { chooseRoute } from '../route.ts'
import { fakeContext, log, track, view } from './fakes.ts'

const queue = view({
  current: track({ title: 'a' }),
  upcoming: [track({ id: 'track-2', title: 'b' })],
  size: 2,
})

const withQueue = fakeContext({ queue })
const withoutQueue = fakeContext({ queue: null })
const bus = commandBus({ specs: commands, logger: log })

describe('chooseRoute', () => {
  test('a route command with no arguments runs', () => {
    const route = chooseRoute(bus, 'pausá', 'pause', withQueue)

    expect(route && 'spec' in route ? route.spec.name : null).toBe('pause')
    expect(route && 'args' in route ? route.args : null).toEqual({})
  })

  test('a queue command without a queue asks to start one', () => {
    expect(chooseRoute(bus, 'pausá', 'pause', withoutQueue)).toEqual({ refusal: MESSAGES.nothingPlaying })
    expect(chooseRoute(bus, 'remove 1', 'remove', withoutQueue)).toEqual({ refusal: MESSAGES.nothingPlaying })
  })

  test('remove needs a valid position or the dj infers it', () => {
    const argsOf = (text: string): unknown => {
      const route = chooseRoute(bus, text, 'remove', withQueue)

      return route && 'args' in route ? route.args : null
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
