import type { DecisionInput, DecisionPort } from '../../ports/decision.ts'
import type { MusicPort, PlayRequest } from '../../ports/music.ts'
import type { SettingsPort } from '../../ports/settings.ts'
import type { DjAgent } from '../messages.ts'
import type { RepliesRecorder, SlotRecorder } from './fakes.ts'
import { describe, expect, test } from 'bun:test'
import { commandBus } from '../../commands/bus.ts'
import { commands } from '../../commands/index.ts'
import { fakeMember, fakeMusic, fakeSettings, fakeVoice, log, view } from '../../commands/tests/fakes.ts'
import { MESSAGES } from '../../messages.ts'
import { messageHandler } from '../messages.ts'
import { fakeIncomingMessage, fakeReplies, fakeSlot } from './fakes.ts'

const BOT = new Map([['999', {}]])
const GUILD = '123456789012345678'

interface SetupOptions {
  music?: MusicPort
  settings?: SettingsPort
  decision?: DecisionPort | null
  agent?: DjAgent | null
  replies?: RepliesRecorder
  slot?: SlotRecorder
  cooldowns?: { plainRequestMs: number, djRequestMs: number }
}

function setup(options: SetupOptions = {}): {
  handler: ReturnType<typeof messageHandler>
  music: MusicPort
  replies: RepliesRecorder
  slot: SlotRecorder
  settings: SettingsPort
} {
  const music = options.music ?? fakeMusic()
  const replies = options.replies ?? fakeReplies()
  const slot = options.slot ?? fakeSlot()
  const settings = options.settings ?? fakeSettings({ textChannelId: '2', persona: null })
  const handler = messageHandler({
    bus: commandBus({ specs: commands, logger: log }),
    music,
    settings,
    replies,
    slot,
    decision: options.decision ?? null,
    agent: options.agent ?? null,
    logger: log,
    cooldowns: options.cooldowns ?? { plainRequestMs: 2_000, djRequestMs: 15_000 },
  })

  return { handler, music, replies, slot, settings }
}

function fakeDecision(choice: string | null): DecisionPort & { inputs: DecisionInput[] } {
  const inputs: DecisionInput[] = []

  return {
    inputs,
    async choose(input) {
      inputs.push(input)

      return choice
    },
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 20; index++)
    await Promise.resolve()
}

describe('messageHandler guard rails', () => {
  test('a bot message returns before touching the player', async () => {
    let views = 0
    const { handler, slot } = setup({
      music: fakeMusic({
        view() {
          views++

          return null
        },
      }),
    })
    const message = fakeIncomingMessage({ bot: true })

    await handler(message.message)

    expect(views).toBe(0)
    expect(message.replies).toEqual([])
    expect(slot.reposts).toEqual([])
  })

  test('a direct message returns before touching the player', async () => {
    let views = 0
    const { handler } = setup({
      music: fakeMusic({
        view() {
          views++

          return null
        },
      }),
    })

    await handler(fakeIncomingMessage({ guildId: null }).message)

    expect(views).toBe(0)
  })

  test('a non-text channel returns before touching the player', async () => {
    let views = 0
    const { handler } = setup({
      music: fakeMusic({
        view() {
          views++

          return null
        },
      }),
    })

    await handler(fakeIncomingMessage({ textBased: false }).message)

    expect(views).toBe(0)
  })
})

describe('messageHandler mentions', () => {
  test('an empty mention in the listening channel asks for the request', async () => {
    const { handler } = setup()
    const message = fakeIncomingMessage({ content: '<@999>', users: BOT })

    await handler(message.message)

    expect(message.replies).toEqual([MESSAGES.emptyMention])
  })

  test('a mention outside the listening channel points at it', async () => {
    const { handler } = setup()
    const message = fakeIncomingMessage({ channelId: '3', content: '<@999> hola', users: BOT })

    await handler(message.message)

    expect(message.replies).toEqual([MESSAGES.wrongChannel('2')])
  })

  test('a mention outside the listening channel is never ignored when none is set', async () => {
    const { handler } = setup({ settings: fakeSettings({ textChannelId: null, persona: null }) })
    const message = fakeIncomingMessage({ channelId: '3', content: '<@999> hola', users: BOT })

    await handler(message.message)

    expect(message.replies).toEqual([MESSAGES.emptyMention])
  })

  test('a mention with a channel and extra words is a request, not a configuration', async () => {
    const { handler, settings } = setup()
    const message = fakeIncomingMessage({
      content: '<@999> <#456> please',
      users: BOT,
      channels: new Map([['456', { id: '456' }]]),
    })

    await handler(message.message)

    expect(message.replies).toEqual([MESSAGES.djUnavailable])
    expect(settings.get(GUILD).textChannelId).toBe('2')
  })

  test('a mention plus one channel configures the listening channel', async () => {
    const { handler, replies, settings } = setup()
    const channel = {
      id: '456',
      name: 'music',
      isTextBased: () => true,
      isThread: () => false,
      archived: false,
      locked: false,
      permissionsFor: () => ({ has: () => true }),
    }
    const message = fakeIncomingMessage({
      channelId: '3',
      content: '<@999> <#456>',
      users: BOT,
      channels: new Map([['456', { id: '456' }]]),
      fetchChannel: id => (id === '456' ? channel : null),
    })

    await handler(message.message)

    expect(settings.get(GUILD).textChannelId).toBe('456')
    expect(replies.said).toEqual([MESSAGES.textChannelConfigured('<#456>')])
  })
})

describe('messageHandler plain queries', () => {
  test('two plain queries from the same user are rate limited', async () => {
    const { handler, replies } = setup({ cooldowns: { plainRequestMs: 10_000, djRequestMs: 15_000 } })
    const first = fakeIncomingMessage({ guildId: '222222222222222222', authorId: 'rate-user', content: 'hola' })
    const second = fakeIncomingMessage({ guildId: '222222222222222222', authorId: 'rate-user', content: 'hola' })

    await handler(first.message)
    await handler(second.message)

    expect(replies.said).toEqual([MESSAGES.joinVoiceChannel])
    expect(second.replies).toEqual([MESSAGES.rateLimited])
  })

  test('plain text outside the listening channel is ignored', async () => {
    const requests: PlayRequest[] = []
    const { handler } = setup({
      music: fakeMusic({
        async play(request) {
          requests.push(request)

          return { added: 1, first: 'a', playlist: null, dropped: 0, total: 1 }
        },
      }),
    })
    const message = fakeIncomingMessage({ channelId: '3', content: 'cumbia' })

    await handler(message.message)

    expect(requests).toEqual([])
    expect(message.replies).toEqual([])
  })

  test('plain text in the listening channel plays the search', async () => {
    const requests: PlayRequest[] = []
    const { handler, slot } = setup({
      music: fakeMusic({
        view: () => view({ size: 1 }),
        async play(request) {
          requests.push(request)

          return { added: 1, first: 'a', playlist: null, dropped: 0, total: 1 }
        },
      }),
    })
    const message = fakeIncomingMessage({ content: 'cumbia', member: fakeMember({ voiceChannel: fakeVoice() }) })

    await handler(message.message)

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ kind: 'text', value: 'cumbia', announce: true })
    expect(slot.reposts).toHaveLength(1)
    expect(slot.reposts[0]?.guildId).toBe(GUILD)
  })
})

describe('messageHandler plain intent', () => {
  test('plain text runs a command without a mention', async () => {
    const music = fakeMusic({ view: () => view({ size: 2 }) })
    const { handler } = setup({ decision: fakeDecision('pause'), music })
    const message = fakeIncomingMessage({ content: 'pausá' })

    await handler(message.message)

    expect(music.calls).toContain('pause')
  })

  test('plain text the router reads as a song plays the search', async () => {
    const requests: PlayRequest[] = []
    const { handler } = setup({
      decision: fakeDecision('query'),
      music: fakeMusic({
        view: () => view({ size: 1 }),
        async play(request) {
          requests.push(request)

          return { added: 1, first: 'a', dropped: 0 }
        },
      }),
    })
    const message = fakeIncomingMessage({ content: 'cumbia', member: fakeMember({ voiceChannel: fakeVoice() }) })

    await handler(message.message)

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ kind: 'text', value: 'cumbia', announce: true })
  })

  test('plain text the router gives to the dj reaches the agent', async () => {
    const requests: string[] = []
    const agent: DjAgent = {
      async ask(input) {
        requests.push(input.request)

        return 'Dale'
      },
    }
    const { handler } = setup({ decision: fakeDecision('dj'), agent })
    const message = fakeIncomingMessage({ content: 'poneme algo tranqui' })

    await handler(message.message)

    expect(requests).toEqual(['poneme algo tranqui'])
    expect(message.replies).toEqual(['Dale'])
  })

  test('a dj choice without a configured model falls back to the search', async () => {
    const requests: PlayRequest[] = []
    const { handler } = setup({
      decision: fakeDecision('dj'),
      music: fakeMusic({
        view: () => view({ size: 1 }),
        async play(request) {
          requests.push(request)

          return { added: 1, first: 'a', dropped: 0 }
        },
      }),
    })
    const message = fakeIncomingMessage({ content: 'rock nacional', member: fakeMember({ voiceChannel: fakeVoice() }) })

    await handler(message.message)

    expect(requests).toHaveLength(1)
  })

  test('a failed decision falls back to the search', async () => {
    const requests: PlayRequest[] = []
    const decision: DecisionPort = {
      async choose() {
        throw new Error('jev down')
      },
    }
    const { handler } = setup({
      decision,
      music: fakeMusic({
        view: () => view({ size: 1 }),
        async play(request) {
          requests.push(request)

          return { added: 1, first: 'a', dropped: 0 }
        },
      }),
    })
    const message = fakeIncomingMessage({ content: 'cumbia', member: fakeMember({ voiceChannel: fakeVoice() }) })

    await handler(message.message)

    expect(requests).toHaveLength(1)
  })

  test('the plain decision sees the routes, the search and the dj', async () => {
    const decision = fakeDecision('query')
    const { handler } = setup({ decision })
    const message = fakeIncomingMessage({ content: 'cumbia' })

    await handler(message.message)

    const input = decision.inputs[0]
    const names = input?.options.map(option => option.name) ?? []

    expect(names).toContain('query')
    expect(names).toContain('dj')
    expect(names).toContain('pause')
  })

  test('a confident route with missing arguments goes to the dj', async () => {
    const requests: string[] = []
    const agent: DjAgent = {
      async ask(input) {
        requests.push(input.request)

        return 'Listo'
      },
    }
    const { handler } = setup({
      decision: fakeDecision('remove'),
      agent,
      music: fakeMusic({ view: () => view({ size: 3 }) }),
    })
    const message = fakeIncomingMessage({ content: 'sacá la tercera' })

    await handler(message.message)

    expect(requests).toEqual(['sacá la tercera'])
  })

  test('a route refusal answers instead of searching', async () => {
    const { handler, replies } = setup({ decision: fakeDecision('pause') })
    const message = fakeIncomingMessage({ content: 'pausá' })

    await handler(message.message)

    expect(replies.said).toEqual([MESSAGES.nothingPlaying])
  })
})

describe('messageHandler dj requests', () => {
  test('a dj request without an LLM says it is unavailable', async () => {
    const { handler } = setup()
    const message = fakeIncomingMessage({ content: '<@999> poneme algo tranqui', users: BOT })

    await handler(message.message)

    expect(message.replies).toEqual([MESSAGES.djUnavailable])
  })

  test('the decision sees the routed commands plus the dj option', async () => {
    const decision = fakeDecision('skip')
    const music = fakeMusic({ view: () => view({ size: 2 }) })
    const { handler } = setup({ decision, music })
    const message = fakeIncomingMessage({ content: '<@999> salta', users: BOT })

    await handler(message.message)

    expect(music.calls).toContain('skip')

    const input = decision.inputs[0]
    const names = input?.options.map(option => option.name) ?? []

    expect(names).toContain('skip')
    expect(names).toContain('pause')
    expect(names).toContain('dj')
    expect(names).not.toContain('query')
    expect(input?.sessionId).toBe('2')
    expect(input?.state.author_in_voice).toBe(false)
  })

  test('a routed remove uses the parsed queue position', async () => {
    const positions: number[] = []
    const { handler } = setup({
      decision: fakeDecision('remove'),
      music: fakeMusic({
        view: () => view({ size: 3 }),
        async remove(_guildId, position) {
          positions.push(position)

          return 'b'
        },
      }),
    })
    const message = fakeIncomingMessage({ content: '<@999> remove 2', users: BOT })

    await handler(message.message)

    expect(positions).toEqual([2])
  })

  test('an unparsed request goes to the dj with the live context', async () => {
    const inputs: { request: string, guildId: string }[] = []
    const agent: DjAgent = {
      async ask(input) {
        inputs.push({ request: input.request, guildId: input.context.guildId })

        return 'Hola'
      },
    }
    const { handler } = setup({ agent })
    const message = fakeIncomingMessage({ content: '<@999> hola dj', users: BOT })

    await handler(message.message)

    expect(message.replies).toEqual(['Hola'])
    expect(inputs).toEqual([{ request: 'hola dj', guildId: GUILD }])
  })

  test('a silent dj reply is not read as an answer', async () => {
    const agent = { ask: async () => null }
    const { handler } = setup({ agent })
    const message = fakeIncomingMessage({ content: '<@999> hola', users: BOT })

    await handler(message.message)

    expect(message.reactions).toEqual(['❌'])
  })

  test('a dj failure replies with its own message', async () => {
    const { handler } = setup({
      agent: {
        async ask() {
          throw new Error('model down')
        },
      },
    })
    const message = fakeIncomingMessage({ content: '<@999> hola', users: BOT })

    await handler(message.message)

    expect(message.replies).toEqual([MESSAGES.djError])
  })

  test('a failed decision falls back to the dj', async () => {
    const decision: DecisionPort = {
      async choose() {
        throw new Error('jev down')
      },
    }
    const agent = { ask: async () => 'Hola' }
    const { handler } = setup({ decision, agent })
    const message = fakeIncomingMessage({ content: '<@999> hola', users: BOT })

    await handler(message.message)

    expect(message.replies).toEqual(['Hola'])
  })

  test('one dj request per channel is in flight at a time', async () => {
    let release: (reply: string | null) => void = () => {}
    const agent: DjAgent = {
      ask: async () => new Promise((resolve) => {
        release = resolve
      }),
    }
    const { handler } = setup({ agent })
    const first = fakeIncomingMessage({ content: '<@999> uno', users: BOT })
    const second = fakeIncomingMessage({ content: '<@999> dos', users: BOT })

    const running = handler(first.message)

    await settle()

    await handler(second.message)

    expect(second.replies).toEqual([MESSAGES.djBusy])

    release('listo')
    await running

    expect(first.replies).toEqual(['listo'])
  })

  test('the channel is busy for the cooldown after the request finishes', async () => {
    const agent = { ask: async () => 'listo' }
    const { handler } = setup({ agent })
    const first = fakeIncomingMessage({ content: '<@999> uno', users: BOT })
    const second = fakeIncomingMessage({ content: '<@999> dos', users: BOT })

    await handler(first.message)
    await handler(second.message)

    expect(first.replies).toEqual(['listo'])
    expect(second.replies).toEqual([MESSAGES.djBusy])
  })
})

describe('messageHandler failures', () => {
  test('a handler failure still answers and still schedules the repost', async () => {
    const settings: SettingsPort = {
      get() {
        throw new Error('settings down')
      },
      async update() {},
      async flush() {},
    }
    const { handler, slot } = setup({ settings, music: fakeMusic({ view: () => view() }) })
    const message = fakeIncomingMessage({ content: 'hola' })

    await handler(message.message)

    expect(message.replies).toEqual([MESSAGES.genericError])
    expect(slot.reposts).toHaveLength(1)
  })
})
