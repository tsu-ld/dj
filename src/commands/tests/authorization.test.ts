import type { VoiceBasedChannel } from 'discord.js'
import { describe, expect, test } from 'bun:test'
import { MESSAGES } from '../../messages.ts'
import { fakeContext, fakeMember, fakeMusic, fakeUi, fakeVoice, silentLog as log, testView as view } from '../../tests/fixtures.ts'
import { commandBus } from '../bus.ts'
import { commands } from '../index.ts'

const CONTROLS: readonly (readonly [string, Record<string, unknown>])[] = [
  ['pause', {}],
  ['resume', {}],
  ['toggle', {}],
  ['skip', {}],
  ['shuffle', {}],
  ['radio', {}],
  ['remove', { position: 2 }],
  ['clear', {}],
]

function contextFor(memberChannel: VoiceBasedChannel | null, botChannel: VoiceBasedChannel | null) {
  const ui = fakeUi()
  const music = fakeMusic({ view: () => view({ size: 3 }) })
  const member = fakeMember({ voiceChannel: memberChannel, botVoiceChannel: botChannel })

  return { context: fakeContext({ member, voiceChannel: memberChannel, services: { music }, ui }), music, ui }
}

describe('voice authorization', () => {
  test('every playback control refuses a member in another voice channel', async () => {
    const bus = commandBus({ specs: commands, logger: log })

    for (const [name, args] of CONTROLS) {
      const { context, music, ui } = contextFor(fakeVoice('voice-member'), fakeVoice('voice-bot'))

      const outcome = await bus.run(name, args, context)

      expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.sameVoiceChannel })
      expect(ui.errors).toEqual([MESSAGES.sameVoiceChannel])
      expect(music.calls).toEqual([])
    }
  })

  test('every playback control refuses a member outside voice while the bot is connected', async () => {
    const bus = commandBus({ specs: commands, logger: log })

    for (const [name, args] of CONTROLS) {
      const { context, music, ui } = contextFor(null, fakeVoice('voice-bot'))

      const outcome = await bus.run(name, args, context)

      expect(outcome).toEqual({ kind: 'refused', message: MESSAGES.sameVoiceChannel })
      expect(ui.errors).toEqual([MESSAGES.sameVoiceChannel])
      expect(music.calls).toEqual([])
    }
  })

  test('every playback control allows a member in the bot voice channel', async () => {
    const bus = commandBus({ specs: commands, logger: log })

    for (const [name, args] of CONTROLS) {
      const { context } = contextFor(fakeVoice('voice-same'), fakeVoice('voice-same'))

      const outcome = await bus.run(name, args, context)

      expect(outcome.kind).toBe('ok')
    }
  })

  test('a member in any voice channel is allowed while the bot is not connected', async () => {
    const bus = commandBus({ specs: commands, logger: log })

    for (const [name, args] of CONTROLS) {
      const { context } = contextFor(fakeVoice('voice-member'), null)

      const outcome = await bus.run(name, args, context)

      expect(outcome.kind).toBe('ok')
    }
  })

  test('queue stays open to a member outside the bot voice channel', async () => {
    const bus = commandBus({ specs: commands, logger: log })
    const { context, ui } = contextFor(fakeVoice('voice-member'), fakeVoice('voice-bot'))

    const outcome = await bus.run('queue', {}, context)

    expect(outcome).toEqual({ kind: 'ok', data: {} })
    expect(ui.queues).toHaveLength(1)
  })
})
