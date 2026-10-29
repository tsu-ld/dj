import type { Interaction } from 'discord.js'
import type { MusicRecorder } from '../../commands/tests/fakes.ts'
import type { ViewMessage } from '../views.ts'
import type { SlotRecorder } from './fakes.ts'
import { describe, expect, test } from 'bun:test'
import { ComponentType, MessageFlags } from 'discord.js'
import { commandBus } from '../../commands/bus.ts'
import { commands } from '../../commands/index.ts'
import { fakeMusic, fakeSettings, log, track, view } from '../../commands/tests/fakes.ts'
import { UserError } from '../../core/errors.ts'
import { MESSAGES } from '../../messages.ts'
import { interactionHandler } from '../interactions.ts'
import { editContent, fakeChannel, fakeInteraction, fakeSlot, optionContent } from './fakes.ts'

function setup(options: { music?: MusicRecorder, slot?: SlotRecorder } = {}): {
  handler: (interaction: Interaction) => Promise<void>
  music: MusicRecorder
  slot: SlotRecorder
} {
  const music = options.music ?? fakeMusic()
  const slot = options.slot ?? fakeSlot()
  const handler = interactionHandler({
    bus: commandBus({ specs: commands, logger: log }),
    music,
    settings: fakeSettings(),
    slot,
    logger: log,
  })

  return { handler, music, slot }
}

interface ButtonInfo {
  readonly customId: string
  readonly disabled: boolean
}

function buttonsOf(message: ViewMessage): ButtonInfo[] {
  return message.components.flatMap(row => row.toJSON().components.flatMap((component) => {
    if (component.type !== ComponentType.Button || !('custom_id' in component))
      return []

    return [{ customId: component.custom_id, disabled: component.disabled ?? false }]
  }))
}

describe('now-playing buttons', () => {
  test('clear asks for confirmation before touching the music', async () => {
    const recorder = fakeInteraction({ customId: 'np:clear' })
    const { handler, music } = setup({ music: fakeMusic({ view: () => view() }) })

    await handler(recorder.interaction)

    const reply = recorder.replies[0]

    expect(optionContent(reply)).toBe(MESSAGES.clearConfirm)
    expect(typeof reply === 'string' ? null : reply?.flags).toBe(MessageFlags.Ephemeral)
    expect(recorder.deferredUpdates()).toBe(0)
    expect(music.calls).not.toContain('stop')
  })

  test('the confirmation clear stops the music and marks the message', async () => {
    const recorder = fakeInteraction({ customId: 'nc:clear:yes' })
    const calls: [string, { resetStation?: boolean } | undefined][] = []
    const music = fakeMusic({
      view: () => view(),
      async stop(guildId, options) {
        calls.push([guildId, options])
      },
    })
    const { handler } = setup({ music })

    await handler(recorder.interaction)

    expect(recorder.deferredUpdates()).toBe(1)
    expect(editContent(recorder.editReplies[0])).toBe('✅')
    expect(calls).toEqual([['123456789012345678', { resetStation: true }]])
  })

  test('cancelling keeps playing', async () => {
    const recorder = fakeInteraction({ customId: 'nc:clear:no' })
    const { handler, music } = setup({ music: fakeMusic({ view: () => view() }) })

    await handler(recorder.interaction)

    expect(editContent(recorder.editReplies[0])).toBe(MESSAGES.clearCancelled)
    expect(music.calls).not.toContain('stop')
  })

  test('confirming with nothing playing says so', async () => {
    const recorder = fakeInteraction({ customId: 'nc:clear:yes' })
    const { handler, music } = setup()

    await handler(recorder.interaction)

    expect(editContent(recorder.editReplies[0])).toBe(MESSAGES.nothingPlaying)
    expect(music.calls).not.toContain('stop')
  })

  test('a now-playing button without a queue says so and does not defer', async () => {
    const recorder = fakeInteraction({ customId: 'np:skip' })
    const { handler, slot } = setup()

    await handler(recorder.interaction)

    expect(optionContent(recorder.replies[0])).toBe(MESSAGES.nothingPlaying)
    expect(recorder.deferredUpdates()).toBe(0)
    expect(slot.shown).toEqual([])
  })

  test('toggle defers first and then toggles', async () => {
    const recorder = fakeInteraction({ customId: 'np:toggle' })
    const { handler, music } = setup({ music: fakeMusic({ view: () => view() }) })

    await handler(recorder.interaction)

    expect(recorder.deferredUpdates()).toBe(1)
    expect(music.calls).toContain('toggle')
    expect(recorder.followUps).toEqual([])
  })

  test('the queue button posts the public queue card', async () => {
    const channel = fakeChannel('2').channel
    const recorder = fakeInteraction({ customId: 'np:queue', channel })
    const current = view({ size: 2 })
    const { handler, slot } = setup({ music: fakeMusic({ view: () => current }) })

    await handler(recorder.interaction)

    expect(recorder.deferredUpdates()).toBe(1)
    expect(slot.shown).toHaveLength(1)
    expect(slot.shown[0]?.view).toBe(current)
    expect(slot.shown[0]?.channel).toBe(channel)
  })

  test('an unknown now-playing button only acknowledges', async () => {
    const recorder = fakeInteraction({ customId: 'np:nope' })
    const { handler, music } = setup({ music: fakeMusic({ view: () => view() }) })

    await handler(recorder.interaction)

    expect(recorder.deferredUpdates()).toBe(1)
    expect(music.calls).toEqual([])
  })

  test('a user error from a button is ephemeral', async () => {
    const recorder = fakeInteraction({ customId: 'np:skip' })
    const { handler } = setup({
      music: fakeMusic({
        view: () => view(),
        async skip() {
          throw new UserError('No puedo saltar.')
        },
      }),
    })

    await handler(recorder.interaction)

    expect(optionContent(recorder.followUps[0])).toBe('No puedo saltar.')
  })

  test('an unexpected button failure surfaces the generic message', async () => {
    const recorder = fakeInteraction({ customId: 'np:skip' })
    const { handler } = setup({
      music: fakeMusic({
        view: () => view(),
        async skip() {
          throw new Error('provider exploded')
        },
      }),
    })

    await handler(recorder.interaction)

    expect(optionContent(recorder.followUps[0])).toBe(MESSAGES.genericError)
  })

  test('a missing guild is ignored', async () => {
    const recorder = fakeInteraction({ customId: 'np:clear', guildId: null })
    const { handler } = setup()

    await handler(recorder.interaction)

    expect(recorder.replies).toEqual([])
    expect(recorder.deferredUpdates()).toBe(0)
  })

  test('non-button interactions are ignored', async () => {
    const recorder = fakeInteraction({ customId: 'np:clear' })
    const notAButton = { ...recorder.interaction, isButton: () => false } as unknown as Interaction
    const { handler } = setup()

    await handler(notAButton)

    expect(recorder.replies).toEqual([])
    expect(recorder.deferredUpdates()).toBe(0)
  })
})

describe('queue pagination', () => {
  function queueOf(count: number): ReturnType<typeof view> {
    return view({
      current: track({ title: 'Song 1' }),
      upcoming: Array.from({ length: count - 1 }, (_, index) => track({ id: `track-${index + 2}`, title: `Song ${index + 2}` })),
      size: count,
    })
  }

  test('next edits the card to the second page', async () => {
    const recorder = fakeInteraction({ customId: 'nq:next:1' })
    const { handler } = setup({ music: fakeMusic({ view: () => queueOf(15) }) })

    await handler(recorder.interaction)

    const message = recorder.edits[0]

    expect(recorder.deferredUpdates()).toBe(1)
    expect(message?.embeds[0]?.toJSON().footer?.text).toBe('Page 2 of 2')

    const buttons = message ? buttonsOf(message) : []

    expect(buttons.map(button => button.customId)).toEqual(['nq:prev:2', 'nq:next:2'])
    expect(buttons[0]?.disabled).toBe(false)
    expect(buttons[1]?.disabled).toBe(true)
  })

  test('previous on the first page stays on the first page', async () => {
    const recorder = fakeInteraction({ customId: 'nq:prev:1' })
    const { handler } = setup({ music: fakeMusic({ view: () => queueOf(15) }) })

    await handler(recorder.interaction)

    expect(recorder.edits[0]?.embeds[0]?.toJSON().footer?.text).toBe('Page 1 of 2')
  })

  test('pagination with nothing playing replaces the card with the reason', async () => {
    const recorder = fakeInteraction({ customId: 'nq:next:1' })
    const { handler } = setup()

    await handler(recorder.interaction)

    const edit = recorder.edits[0]

    expect(edit?.embeds).toEqual([])
    expect(edit?.components).toEqual([])
  })

  test('a page that is not a number only acknowledges', async () => {
    const recorder = fakeInteraction({ customId: 'nq:next:not-a-number' })
    const { handler } = setup({ music: fakeMusic({ view: () => queueOf(15) }) })

    await handler(recorder.interaction)

    expect(recorder.deferredUpdates()).toBe(1)
    expect(recorder.edits).toEqual([])
  })
})
