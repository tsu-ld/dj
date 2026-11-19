import type { ContainerBuilder } from 'discord.js'
import type { QueueView } from '../../ports/music.ts'
import type { ViewMessage } from '../views.ts'
import { describe, expect, test } from 'bun:test'
import { ButtonStyle, ComponentType, MessageFlags } from 'discord.js'
import { track, view } from '../../commands/tests/fakes.ts'
import { clearConfirmation, noticeMessage, nowPlayingMessage, queueMessage } from '../views.ts'
import { buttonsOf, queueOf, textsOf } from './fakes.ts'

function containerOf(message: ViewMessage): ReturnType<ContainerBuilder['toJSON']> {
  const container = message.components[0]

  if (!container)
    throw new Error('missing container')

  return container.toJSON()
}

function textMatching(message: ViewMessage, pattern: RegExp): string | undefined {
  return textsOf(message).find(value => pattern.test(value))
}

function queueLines(message: ViewMessage): string[] {
  const list = textsOf(message).find(value => /^\d/.test(value) || value.startsWith('▶'))

  return list?.split('\n') ?? []
}

describe('queueMessage', () => {
  test('the first queue page lists ten songs and disables previous', () => {
    const message = queueMessage(queueOf(15), 1)
    const lines = queueLines(message)

    expect(lines).toHaveLength(10)
    expect(lines[0]).toBe('▶ 1. Song 1 · 3:00')
    expect(textMatching(message, /Page 1 of 2/)).toBeDefined()
    expect(textMatching(message, /15 songs/)).toBeDefined()

    const [previous, next] = buttonsOf(message)

    expect(previous?.disabled).toBe(true)
    expect(next?.disabled).toBe(false)
    expect(previous?.customId).toBe('nq:prev:1')
    expect(next?.customId).toBe('nq:next:1')
  })

  test('the second queue page lists the rest and disables next', () => {
    const lines = queueLines(queueMessage(queueOf(15), 2))

    expect(lines).toHaveLength(5)
    expect(lines[0]).toBe('11. Song 11 · 3:00')

    const [previous, next] = buttonsOf(queueMessage(queueOf(15), 2))

    expect(previous?.disabled).toBe(false)
    expect(next?.disabled).toBe(true)
  })

  test('out-of-range pages are clamped to the real pages', () => {
    expect(textMatching(queueMessage(queueOf(15), 0), /Page 1 of 2/)).toBeDefined()
    expect(textMatching(queueMessage(queueOf(15), 99), /Page 2 of 2/)).toBeDefined()
  })

  test('an empty queue explains how to start it', () => {
    const message = queueMessage(queueOf(0), 1)

    expect(textMatching(message, /^## Queue/m)).toContain('Nothing queued yet.')
    expect(textMatching(message, /Ask me for a song/)).toBeDefined()
    expect(buttonsOf(message)).toEqual([])
    expect(containerOf(message).accent_color).toBe(0x57F287)
  })

  test('a single page has no paging controls', () => {
    expect(buttonsOf(queueMessage(queueOf(3), 1))).toEqual([])
  })

  test('the current song is marked first and the upcoming songs follow', () => {
    const lines = queueLines(queueMessage(queueOf(3), 1))

    expect(lines).toEqual(['▶ 1. Song 1 · 3:00', '2. Song 2 · 3:00', '3. Song 3 · 3:00'])
  })

  test('the total duration is shown once and unknown songs are marked', () => {
    const known = queueMessage(queueOf(3), 1)
    const mixed = queueMessage(view({
      current: track(),
      upcoming: [track({ id: 'track-2', title: 'Song 2', durationSeconds: 0 })],
      size: 2,
    }), 1)

    expect(textMatching(known, /3 songs · 9m/)).toBeDefined()
    expect(textMatching(mixed, /2 songs · ~3m/)).toBeDefined()
  })

  test('titles are escaped so markdown cannot change the list', () => {
    const message = queueMessage(view({
      current: track({ title: '*Song* [1]' }),
      size: 1,
    }), 1)

    expect(queueLines(message)[0]).toBe('▶ 1. \\*Song\\* \\[1\\] · 3:00')
  })

  test('a paused queue uses the paused accent', () => {
    expect(containerOf(queueMessage(view({ paused: true, size: 1 }), 1)).accent_color).toBe(0xFEE75C)
  })
})

function card(input: QueueView): ViewMessage {
  const message = nowPlayingMessage(input)

  if (!message)
    throw new Error('missing now-playing card')

  return message
}

describe('nowPlayingMessage', () => {
  test('the card shows the paused state', () => {
    const playing = card(queueOf(2))
    const paused = card(view({ paused: true, size: 2 }))

    expect(textMatching(playing, /\*\*Playing\*\*/)).toBeDefined()
    expect(textMatching(paused, /\*\*Paused\*\*/)).toBeDefined()
    expect(containerOf(playing).accent_color).toBe(0x57F287)
    expect(containerOf(paused).accent_color).toBe(0xFEE75C)
  })

  test('the toggle button names the action it triggers', () => {
    const playing = buttonsOf(card(queueOf(2)))
    const paused = buttonsOf(card(view({ paused: true, size: 2 })))

    expect(playing[0]?.label).toBe('Pause')
    expect(paused[0]?.label).toBe('Resume')
    expect(playing[0]?.emoji).toBe('⏸️')
    expect(paused[0]?.emoji).toBe('▶️')
  })

  test('the buttons, radio state and queue count match the card', () => {
    const upcoming = Array.from({ length: 3 }, (_, index) => track({ id: `track-${index + 2}`, title: `Song ${index + 2}` }))
    const message = card(view({ radio: true, size: 4, upcoming }))
    const buttons = buttonsOf(message)

    expect(buttons.map(button => button.customId)).toEqual([
      'np:toggle',
      'np:skip',
      'np:shuffle',
      'np:radio',
      'np:queue',
      'np:clear',
    ])
    expect(buttons[3]?.style).toBe(ButtonStyle.Success)
    expect(buttons[5]?.label).toBe('Leave')
    expect(buttons[5]?.style).toBe(ButtonStyle.Danger)
    expect(textMatching(message, /3 in queue · radio on/)).toBeDefined()
  })

  test('a song playing alone does not claim a queue', () => {
    expect(textMatching(card(view({ size: 1 })), /in queue/)).toBeUndefined()
  })

  test('a song without a duration leaves the label out', () => {
    const message = card(view({ current: track({ durationSeconds: 0 }) }))
    const status = textMatching(message, /\*\*Playing\*\*/) ?? ''

    expect(status).toContain('**Playing**')
    expect(status).not.toContain('Unknown')
  })

  test('a live song is labelled live', () => {
    expect(textMatching(card(view({ current: track({ isLive: true }) })), /\*\*Playing\*\* · Live/)).toBeDefined()
  })

  test('a known duration is formatted in minutes and seconds', () => {
    expect(textMatching(card(view({ current: track({ durationSeconds: 185 }) })), /\*\*Playing\*\* · 3:05/)).toBeDefined()
  })

  test('an unknown requester is left out instead of labelled unknown', () => {
    const status = textMatching(card(view({ current: track({ requestedBy: null }) })), /\*\*Playing\*\*/) ?? ''

    expect(status).not.toContain('Requested by')
    expect(status).not.toContain('Unknown')
  })

  test('a song the radio picked credits the radio', () => {
    const inherited = card(view({ current: track({ requestedBy: 'tsu', fromRadio: true }) }))
    const anonymous = card(view({ current: track({ requestedBy: null, fromRadio: true }) }))

    expect(textMatching(inherited, /Picked by radio/)).toBeDefined()
    expect(textMatching(anonymous, /Picked by radio/)).toBeDefined()
  })

  test('the next songs are previewed with their queue positions', () => {
    const current = track({ title: 'Song 1' })
    const upcoming = Array.from({ length: 5 }, (_, index) => track({ id: `track-${index + 2}`, title: `Song ${index + 2}` }))
    const preview = textMatching(card(view({ current, upcoming, size: 6 })), /\*\*Up next\*\*/) ?? ''

    expect(preview.split('\n')).toEqual([
      '**Up next**',
      '2. Song 2 · 3:00',
      '3. Song 3 · 3:00',
      '4. Song 4 · 3:00',
      '-# and 2 more',
    ])
  })

  test('the artwork becomes a thumbnail section', () => {
    const art = 'https://i.ytimg.com/vi/1/hq.jpg'
    const withArt = card(view({ current: track({ thumbnail: art }) }))
    const withoutArt = card(view({ current: track({ thumbnail: null }) }))
    const unsafeArt = card(view({ current: track({ thumbnail: 'javascript:alert(1)' }) }))
    const section = containerOf(withArt).components.find(component => component.type === ComponentType.Section)

    expect(section).toMatchObject({ type: ComponentType.Section, accessory: { media: { url: art } } })
    expect(containerOf(withoutArt).components.some(component => component.type === ComponentType.Section)).toBe(false)
    expect(containerOf(unsafeArt).components.some(component => component.type === ComponentType.Section)).toBe(false)
  })

  test('the title links to the song and escapes markdown in its text', () => {
    const message = card(view({ current: track({ title: '[live] *mix*', requestedBy: 'tsu' }) }))

    expect(textMatching(message, /^## /)).toBe('## [\\[live\\] \\*mix\\*](https://youtu.be/1)\n**Playing** · 3:00 · Requested by tsu')
  })

  test('a parenthesized URL keeps the markdown link intact', () => {
    const message = card(view({ current: track({ title: 'Mix', url: 'https://example.com/a(b', requestedBy: 'tsu' }) }))

    expect(textMatching(message, /^## /)).toBe('## [Mix](https://example.com/a%28b)\n**Playing** · 3:00 · Requested by tsu')
  })

  test('a non-http song URL is not turned into a link', () => {
    const message = card(view({ current: track({ title: 'Mix', url: 'javascript:alert(1)', requestedBy: 'tsu' }) }))

    expect(textMatching(message, /^## /)).toBe('## Mix\n**Playing** · 3:00 · Requested by tsu')
  })

  test('the card is a components v2 message', () => {
    const message = card(queueOf(1))

    expect(message.flags).toBe(MessageFlags.IsComponentsV2)
    expect(message.allowedMentions).toEqual({ parse: [] })
  })

  test('an @everyone in a title cannot ping the channel', () => {
    const message = card(view({ current: track({ title: '@everyone listen' }) }))

    expect(message.allowedMentions).toEqual({ parse: [] })
  })

  test('a card without a current song is not rendered', () => {
    expect(nowPlayingMessage(view({ current: null, size: 0 }))).toBeNull()
  })

  test('the elapsed time and a progress bar follow the status line', () => {
    const message = nowPlayingMessage(view({ current: track({ title: 'Mix', durationSeconds: 200, requestedBy: 'tsu' }) }), 50_000)
    const header = message ? textMatching(message, /^## /) : undefined

    expect(header).toBe('## [Mix](https://youtu.be/1)\n**Playing** · 3:20 · Requested by tsu\n▰▰▰▱▱▱▱▱▱▱▱▱ `0:50 / 3:20`')
  })

  test('the elapsed time is clamped to the song and hours are shown', () => {
    const long = nowPlayingMessage(view({ current: track({ durationSeconds: 3_725 }) }), 3_725_000 + 9_000)
    const early = nowPlayingMessage(view({ current: track({ durationSeconds: 180 }) }), -5)

    expect(long ? textMatching(long, /1:02:05 \/ 1:02:05/) : undefined).toContain('▰▰▰▰▰▰▰▰▰▰▰▰')
    expect(early ? textMatching(early, /0:00 \/ 3:00/) : undefined).toContain('▱▱▱▱▱▱▱▱▱▱▱▱')
  })

  test('a live or unknown-length song has no progress line', () => {
    const live = card(view({ current: track({ isLive: true }) }))
    const unknown = nowPlayingMessage(view({ current: track({ durationSeconds: 0 }) }), 10_000)
    const live2 = nowPlayingMessage(view({ current: track({ isLive: true }) }), 10_000)

    for (const message of [live, unknown, live2])
      expect(message ? textMatching(message, / \/ /) : 'missing').toBeUndefined()
  })
})

describe('noticeMessage', () => {
  test('a notice is a text-only components v2 card', () => {
    const message = noticeMessage('Nothing is playing right now.')

    expect(textsOf(message)).toEqual(['Nothing is playing right now.'])
    expect(message.flags).toBe(MessageFlags.IsComponentsV2)
  })
})

describe('clearConfirmation', () => {
  test('asks first with an ephemeral leave and cancel', () => {
    const confirmation = clearConfirmation()
    const buttons = confirmation.components
      .flatMap(row => row.toJSON().components)
      .flatMap((component) => {
        if (component.type !== ComponentType.Button || !('custom_id' in component))
          return []

        return [{ customId: component.custom_id, label: component.label ?? '' }]
      })

    expect(confirmation.content).toBe('Clear the queue and leave the voice channel?')
    expect(confirmation.flags).toBe(MessageFlags.Ephemeral)
    expect(buttons.map(button => button.customId)).toEqual(['nc:clear:yes', 'nc:clear:no'])
    expect(buttons.map(button => button.label)).toEqual(['Leave', 'Cancel'])
  })
})
