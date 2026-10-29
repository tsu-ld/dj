import type { ActionRowBuilder, EmbedBuilder, MessageActionRowComponentBuilder } from 'discord.js'
import type { QueueView } from '../../ports/music.ts'
import { describe, expect, test } from 'bun:test'
import { ButtonStyle, ComponentType, MessageFlags } from 'discord.js'
import { track, view } from '../../commands/tests/fakes.ts'
import { clearConfirmation, nowPlayingMessage, queueMessage } from '../views.ts'

interface ButtonInfo {
  readonly customId: string
  readonly label: string
  readonly disabled: boolean
  readonly style: number
}

function buttonsOf(components: readonly ActionRowBuilder<MessageActionRowComponentBuilder>[]): ButtonInfo[] {
  return components.flatMap(row => row.toJSON().components.flatMap((component) => {
    if (component.type !== ComponentType.Button || !('custom_id' in component))
      return []

    return [{
      customId: component.custom_id,
      label: component.label ?? '',
      disabled: component.disabled ?? false,
      style: component.style,
    }]
  }))
}

function queueOf(count: number): QueueView {
  if (count === 0)
    return view({ current: null, upcoming: [], size: 0 })

  return view({
    current: track({ title: 'Song 1' }),
    upcoming: Array.from({ length: count - 1 }, (_, index) => track({ id: `track-${index + 2}`, title: `Song ${index + 2}` })),
    size: count,
  })
}

function footer(embed: EmbedBuilder | undefined): string | undefined {
  return embed?.toJSON().footer?.text
}

function field(embed: EmbedBuilder | undefined, name: string): string | undefined {
  return embed?.toJSON().fields?.find(entry => entry.name === name)?.value
}

describe('queueMessage', () => {
  test('the first queue page lists ten songs and disables previous', () => {
    const message = queueMessage(queueOf(15), 1)
    const data = message.embeds[0]?.toJSON()

    expect(data?.description?.split('\n')).toHaveLength(10)
    expect(data?.description?.split('\n')[0]).toBe('1. Song 1')
    expect(footer(message.embeds[0])).toBe('Page 1 of 2')

    const [previous, next] = buttonsOf(message.components)

    expect(previous?.disabled).toBe(true)
    expect(next?.disabled).toBe(false)
    expect(previous?.customId).toBe('nq:prev:1')
    expect(next?.customId).toBe('nq:next:1')
  })

  test('the second queue page lists the rest and disables next', () => {
    const message = queueMessage(queueOf(15), 2)
    const lines = message.embeds[0]?.toJSON().description?.split('\n') ?? []

    expect(lines).toHaveLength(5)
    expect(lines[0]).toBe('11. Song 11')

    const [previous, next] = buttonsOf(message.components)

    expect(previous?.disabled).toBe(false)
    expect(next?.disabled).toBe(true)
  })

  test('out-of-range pages are clamped to the real pages', () => {
    expect(footer(queueMessage(queueOf(15), 0).embeds[0])).toBe('Page 1 of 2')
    expect(footer(queueMessage(queueOf(15), 99).embeds[0])).toBe('Page 2 of 2')
  })

  test('an empty queue is one empty page', () => {
    const message = queueMessage(queueOf(0), 1)
    const data = message.embeds[0]?.toJSON()

    expect(data?.title).toBe('Queue (0 songs)')
    expect(data?.description).toBe('Empty')
    expect(footer(message.embeds[0])).toBe('Page 1 of 1')

    for (const button of buttonsOf(message.components))
      expect(button.disabled).toBe(true)
  })

  test('the current song is position one and the upcoming songs follow', () => {
    const message = queueMessage(queueOf(3), 1)
    const lines = message.embeds[0]?.toJSON().description?.split('\n') ?? []

    expect(lines).toEqual(['1. Song 1', '2. Song 2', '3. Song 3'])
  })
})

describe('nowPlayingMessage', () => {
  test('the card shows the paused state', () => {
    const playing = nowPlayingMessage(queueOf(2))
    const paused = nowPlayingMessage(view({ paused: true, size: 2 }))

    expect(field(playing?.embeds[0], 'Status')).toBe('Playing')
    expect(field(paused?.embeds[0], 'Status')).toBe('Paused')
  })

  test('the toggle button names the action it triggers', () => {
    const playing = buttonsOf(nowPlayingMessage(queueOf(2))?.components ?? [])
    const paused = buttonsOf(nowPlayingMessage(view({ paused: true, size: 2 }))?.components ?? [])

    expect(playing[0]?.label).toBe('Pause')
    expect(paused[0]?.label).toBe('Resume')
  })

  test('the buttons, radio state and queue count match the old card', () => {
    const message = nowPlayingMessage(view({ radio: true, size: 4 }))
    const buttons = buttonsOf(message?.components ?? [])

    expect(buttons.map(button => button.customId)).toEqual([
      'np:toggle',
      'np:skip',
      'np:radio',
      'np:shuffle',
      'np:clear',
      'np:queue',
    ])
    expect(buttons[2]?.style).toBe(ButtonStyle.Success)
    expect(buttons[4]?.style).toBe(ButtonStyle.Danger)
    expect(footer(message?.embeds[0])).toBe('3 in queue')
  })

  test('a song without a duration gets a safe placeholder', () => {
    const message = nowPlayingMessage(view({ current: track({ durationSeconds: 0 }) }))

    expect(field(message?.embeds[0], 'Duration')).toBe('Unknown')
    expect(field(message?.embeds[0], 'Duration')?.length ?? 0).toBeGreaterThan(0)
  })

  test('a live song is labelled live', () => {
    const message = nowPlayingMessage(view({ current: track({ isLive: true }) }))

    expect(field(message?.embeds[0], 'Duration')).toBe('Live')
  })

  test('a known duration is formatted in minutes and seconds', () => {
    const message = nowPlayingMessage(view({ current: track({ durationSeconds: 185 }) }))

    expect(field(message?.embeds[0], 'Duration')).toBe('3:05')
  })

  test('an unknown requester is labelled unknown', () => {
    const message = nowPlayingMessage(view({ current: track({ requestedBy: null }) }))

    expect(field(message?.embeds[0], 'Requested by')).toBe('Unknown')
  })

  test('a card without a current song is not rendered', () => {
    expect(nowPlayingMessage(view({ current: null, size: 0 }))).toBeNull()
  })
})

describe('clearConfirmation', () => {
  test('asks first with an ephemeral clear and cancel', () => {
    const confirmation = clearConfirmation()
    const buttons = buttonsOf(confirmation.components)

    expect(confirmation.content).toBe('Clear the queue and leave the voice channel?')
    expect(confirmation.flags).toBe(MessageFlags.Ephemeral)
    expect(buttons.map(button => button.customId)).toEqual(['nc:clear:yes', 'nc:clear:no'])
    expect(buttons.map(button => button.label)).toEqual(['Clear', 'Cancel'])
  })
})
