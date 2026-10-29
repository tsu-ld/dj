import { expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.js'
import { chooseRoute } from '../route.js'

const queue = { songs: [{ name: 'a' }, { name: 'b' }] }

test('a route action with no arguments runs', () => {
  const route = chooseRoute('pausá', 'pause', { queue })

  expect(route.action.name).toBe('pause')
  expect(route.args).toEqual({})
})

test('a queue command without a queue asks to start one', () => {
  expect(chooseRoute('pausá', 'pause', { queue: null })).toEqual({ refusal: MESSAGES.nothingPlaying })
  expect(chooseRoute('remove 1', 'remove', { queue: null })).toEqual({ refusal: MESSAGES.nothingPlaying })
})

test('remove needs a valid position or the dj infers it', () => {
  expect(chooseRoute('remove 2', 'remove', { queue }).args).toEqual({ position: 2 })
  expect(chooseRoute('remove 2.5', 'remove', { queue })).toBeNull()
  expect(chooseRoute('remove 9', 'remove', { queue })).toBeNull()
  expect(chooseRoute('remove the third', 'remove', { queue })).toBeNull()
})

test('internal or unknown actions never route directly', () => {
  expect(chooseRoute('sé un dj', 'set_persona', { queue })).toBeNull()
  expect(chooseRoute('usa esto', 'query', { queue })).toBeNull()
  expect(chooseRoute('hola', 'nope', { queue })).toBeNull()
  expect(chooseRoute('hola', 'dj', { queue })).toBeNull()
})
