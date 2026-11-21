import type { GuildMember, GuildTextBasedChannel, Message, VoiceBasedChannel } from 'discord.js'
import type { CommandContext, CommandServices, CommandUi } from '../commands/spec.ts'
import type { Clock } from '../core/clock.ts'
import type { JsonRecord } from '../core/json.ts'
import type { Logger } from '../core/logger.ts'
import type { CompletionReply, CompletionRequest, ConversationPort } from '../ports/conversation.ts'
import type { MusicPort, PlayRequest, PlayResult, QueueView, Track } from '../ports/music.ts'
import type { GuildSettings, SettingsPort } from '../ports/settings.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { systemClock } from '../core/clock.ts'
import { isRecord, parseJson } from '../core/json.ts'
import { logger } from '../core/logger.ts'

export interface TestClock extends Clock {
  advance: (milliseconds: number) => void
}

export function testClock(start = 1_000_000): TestClock {
  let now = start

  return {
    now: () => now,
    advance(milliseconds) {
      now += milliseconds
    },
  }
}

export const silentLog: Logger = logger({
  level: 'error',
  clock: systemClock,
  out: { write: () => {} },
})

export function testTrack(
  first: string | Partial<Track> = {},
  overrides: Partial<Track> = {},
): Track {
  const input =
    typeof first === 'string' ? { title: first, ...overrides } : { ...first, ...overrides }
  const title = input.title ?? 'Song 1'

  return {
    id: input.id ?? title,
    title,
    url: 'https://youtu.be/1',
    durationSeconds: 180,
    isLive: false,
    thumbnail: null,
    requestedBy: null,
    requesterId: null,
    artist: null,
    fromRadio: false,
    ...input,
  }
}

export function testView(overrides: Partial<QueueView> = {}): QueueView {
  const current = overrides.current === undefined ? testTrack() : overrides.current
  const upcoming = overrides.upcoming ?? []

  return {
    current,
    upcoming,
    paused: false,
    radio: false,
    size: (current === null ? 0 : 1) + upcoming.length,
    ...overrides,
  }
}

const tempDirs: Array<string> = []

export async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dj-test-'))

  tempDirs.push(directory)

  return directory
}

export async function removeTempDirs(): Promise<void> {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  )
}

export async function settle(): Promise<void> {
  for (let turn = 0; turn < 40; turn++) {
    await Promise.resolve()
  }
}

export interface CapturedLog {
  logger: Logger
  events: Array<string>
  entries: (event: string) => Array<unknown>
}

export function captureLog(): CapturedLog {
  const records: Array<JsonRecord> = []
  const events: Array<string> = []

  return {
    logger: logger({
      level: 'debug',
      clock: systemClock,
      out: {
        write(text) {
          const parsed = parseJson(text)

          if (isRecord(parsed) && typeof parsed.event === 'string') {
            records.push(parsed)
            events.push(parsed.event)
          }
        },
      },
    }),
    events,
    entries: (event) => records.filter((record) => record.event === event),
  }
}

export function queueOf(count: number): QueueView {
  if (count === 0) {
    return testView({ current: null, upcoming: [], size: 0 })
  }

  return testView({
    current: testTrack({ title: 'Song 1' }),
    upcoming: Array.from({ length: count - 1 }, (_, index) =>
      testTrack({ id: `track-${index + 2}`, title: `Song ${index + 2}` }),
    ),
    size: count,
  })
}

export function fakeVoice(id = 'voice-1'): VoiceBasedChannel {
  return { id } as unknown as VoiceBasedChannel
}

export function fakeMember(
  options: {
    allowed?: boolean
    voiceChannel?: VoiceBasedChannel | null
    botVoiceChannel?: VoiceBasedChannel | null
  } = {},
): GuildMember {
  return {
    permissions: { has: () => options.allowed ?? true },
    voice: { channel: options.voiceChannel ?? null },
    guild: {
      members: {
        me: { voice: { channelId: options.botVoiceChannel?.id ?? null } },
      },
    },
  } as unknown as GuildMember
}

interface TextChannelRecorder {
  readonly channel: GuildTextBasedChannel
  readonly sent: Array<string>
  readonly typing: { count: number }
}

export function fakeTextChannel(
  options: { id?: string; failSend?: boolean; failTyping?: boolean } = {},
): TextChannelRecorder {
  const sent: Array<string> = []
  const typing = { count: 0 }
  const channel = {
    id: options.id ?? 'chan-1',
    isTextBased: () => true,
    async send(content: string) {
      if (options.failSend) {
        throw new Error('send failed')
      }

      sent.push(content)

      return null
    },
    async sendTyping() {
      typing.count++

      if (options.failTyping) {
        throw new Error('typing failed')
      }
    },
  } as unknown as GuildTextBasedChannel

  return { channel, sent, typing }
}

export interface MusicRecorder extends MusicPort {
  readonly calls: Array<string>
}

export function fakeMusic(overrides: Partial<MusicPort> = {}): MusicRecorder {
  const calls: Array<string> = []

  const music: MusicPort = {
    async play() {
      calls.push('play')

      return { added: 0, first: null, dropped: 0 }
    },
    async pause() {
      calls.push('pause')
    },
    async resume() {
      calls.push('resume')
    },
    async toggle() {
      calls.push('toggle')

      return true
    },
    async skip() {
      calls.push('skip')
    },
    async stop() {
      calls.push('stop')
    },
    async shuffle() {
      calls.push('shuffle')
    },
    async remove() {
      calls.push('remove')

      return ''
    },
    async radio() {
      calls.push('radio')

      return true
    },
    async seek() {
      calls.push('seek')
    },
    view() {
      return null
    },
    status: () => null,
    audio: {
      async playClip() {
        return false
      },
    },
    on() {
      return () => {}
    },
    async dispose() {},
  }

  return { ...music, calls, ...overrides }
}

export function collector(
  requests: Array<PlayRequest>,
  result: Partial<PlayResult> = {},
  overrides: Partial<MusicPort> = {},
): MusicRecorder {
  return fakeMusic({
    ...overrides,
    async play(request) {
      requests.push(request)

      return { added: 1, first: 'a', dropped: 0, ...result }
    },
  })
}

interface SettingsRecorder extends SettingsPort {
  readonly updates: Array<[string, Partial<GuildSettings>]>
  readonly current: () => GuildSettings
}

export function fakeSettings(initial: Partial<GuildSettings> = {}): SettingsRecorder {
  const updates: Array<[string, Partial<GuildSettings>]> = []
  let value: GuildSettings = { textChannelId: null, persona: null, ...initial }

  return {
    updates,
    get: () => ({ ...value }),
    async update(guildId, patch) {
      updates.push([guildId, patch])
      value = { ...value, ...patch }
    },
    async flush() {},
    current: () => ({ ...value }),
  }
}

interface UiRecorder extends CommandUi {
  readonly replies: Array<string>
  readonly errors: Array<string>
  readonly acks: () => number
  readonly queues: Array<QueueView>
}

export function fakeUi(): UiRecorder {
  const replies: Array<string> = []
  const errors: Array<string> = []
  const queues: Array<QueueView> = []
  let acks = 0

  return {
    replies,
    errors,
    queues,
    acks: () => acks,
    async reply(text) {
      replies.push(text)
    },
    async error(message) {
      errors.push(message)
    },
    async ack() {
      acks++
    },
    async showQueue(queueView) {
      queues.push(queueView)
    },
  }
}

export interface ContextOptions {
  guildId?: string
  member?: GuildMember
  voiceChannel?: VoiceBasedChannel | null
  textChannel?: GuildTextBasedChannel
  message?: Message | null
  services?: Partial<CommandServices>
  ui?: CommandUi
}

export function fakeContext(options: ContextOptions = {}): CommandContext {
  return {
    guildId: options.guildId ?? '123456789012345678',
    member: options.member ?? fakeMember(),
    voiceChannel: options.voiceChannel === undefined ? fakeVoice() : options.voiceChannel,
    textChannel: options.textChannel ?? fakeTextChannel().channel,
    message: options.message ?? null,
    services: {
      music: fakeMusic(),
      settings: fakeSettings(),
      logger: silentLog,
      ...options.services,
    },
    ui: options.ui ?? fakeUi(),
  }
}

type ModelStep =
  | CompletionReply
  | Promise<CompletionReply>
  | ((request: CompletionRequest) => CompletionReply | Promise<CompletionReply>)

interface ScriptedModel extends ConversationPort {
  readonly requests: Array<CompletionRequest>
}

export function scriptedModel(steps: ReadonlyArray<ModelStep>): ScriptedModel {
  const requests: Array<CompletionRequest> = []
  let index = 0

  return {
    requests,
    async complete(request) {
      requests.push(request)

      const step = steps[index]

      index++

      if (!step) {
        return { text: null, toolCalls: [] }
      }

      return typeof step === 'function' ? step(request) : step
    },
  }
}

export function textReply(text: string): CompletionReply {
  return { text, toolCalls: [] }
}
