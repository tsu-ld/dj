import { describe, expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.ts'
import { commandBus } from '../bus.ts'
import { commands } from '../index.ts'
import { pause, radio, resume, shuffle, skip, toggle } from '../playback.ts'
import { fakeContext, fakeMusic, fakeUi, log, track, view } from './fakes.ts'

describe('playback commands', () => {
  test('pause pauses a playing queue only once', async () => {
    let paused = false
    let calls = 0
    const music = fakeMusic({
      async pause() {
        paused = true
        calls++
      },
    })

    expect(await pause.run({}, fakeContext({ services: { music }, queue: view({ paused: false }) }))).toEqual({ paused: true })
    expect(await pause.run({}, fakeContext({ services: { music }, queue: view({ paused: true }) }))).toEqual({ paused: true })
    expect(paused).toBe(true)
    expect(calls).toBe(1)
  })

  test('resume resumes a paused queue only once', async () => {
    let paused = true
    let calls = 0
    const music = fakeMusic({
      async resume() {
        paused = false
        calls++
      },
    })

    expect(await resume.run({}, fakeContext({ services: { music }, queue: view({ paused: true }) }))).toEqual({ paused: false })
    expect(await resume.run({}, fakeContext({ services: { music }, queue: view({ paused: false }) }))).toEqual({ paused: false })
    expect(paused).toBe(false)
    expect(calls).toBe(1)
  })

  test('toggle reports the state the music engine left behind', async () => {
    const music = fakeMusic({ toggle: async () => false })

    expect(await toggle.run({}, fakeContext({ services: { music }, queue: view() }))).toEqual({ paused: false })
  })

  test('skip names the song that was playing', async () => {
    const music = fakeMusic()

    const data = await skip.run({}, fakeContext({ services: { music }, queue: view({ current: track({ title: 'Antes' }) }) }))

    expect(data).toEqual({ skipped: 'Antes' })
    expect(music.calls).toContain('skip')
  })

  test('shuffle reports the queue size', async () => {
    const music = fakeMusic()

    expect(await shuffle.run({}, fakeContext({ services: { music }, queue: view({ size: 3 }) }))).toEqual({ shuffled: 3 })
    expect(music.calls).toContain('shuffle')
  })

  test('radio reports the state the music engine returned', async () => {
    const music = fakeMusic({ radio: async () => true })

    expect(await radio.run({}, fakeContext({ services: { music }, queue: view() }))).toEqual({ radio: true })
  })

  test('every playback command refuses without a queue', async () => {
    const bus = commandBus({ specs: commands, logger: log })

    for (const spec of [pause, resume, toggle, skip, shuffle, radio]) {
      const ui = fakeUi()
      const outcome = await bus.run(spec.name, {}, fakeContext({ ui }))

      expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.nothingPlaying })
      expect(ui.errors).toEqual([MESSAGES.nothingPlaying])
    }
  })
})
