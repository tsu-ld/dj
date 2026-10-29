import type { Clock } from '../../core/clock.ts'
import type { CompletionReply, CompletionRequest, ConversationPort } from '../../ports/conversation.ts'
import type { MusicPort, QueueView, Track } from '../../ports/music.ts'
import type { SettingsPort } from '../../ports/settings.ts'
import type { SpeechPort } from '../../ports/speech.ts'
import type { OnAirHost } from '../host.ts'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { logger } from '../../core/logger.ts'
import { onAirHost } from '../host.ts'

interface TestClock extends Clock {
  advance: (milliseconds: number) => void
}

interface MusicFake {
  port: MusicPort
  clips: string[]
  subscriptions: string[]
  setView: (guildId: string, view: QueueView | null) => void
}

interface SpeechFake {
  port: SpeechPort
  calls: string[]
  files: string[]
}

interface ModelFake {
  port: ConversationPort
  requests: CompletionRequest[]
}

let directory = ''

const settings: SettingsPort = {
  get: () => ({ textChannelId: null, persona: null }),
  update: async () => {},
  flush: async () => {},
}

const log = logger({ level: 'error', sink: () => {} })

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dj-on-air-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function track(title: string, extra: Partial<Track> = {}): Track {
  return {
    id: title,
    title,
    url: `https://example.test/${encodeURIComponent(title)}`,
    durationSeconds: 200,
    isLive: false,
    thumbnail: null,
    requestedBy: null,
    fromRadio: false,
    ...extra,
  }
}

function view(input: { current?: Track | null, upcoming?: readonly Track[], paused?: boolean } = {}): QueueView {
  const current = input.current ?? null
  const upcoming = input.upcoming ?? []

  return {
    current,
    upcoming,
    paused: input.paused ?? false,
    radio: false,
    size: (current ? 1 : 0) + upcoming.length,
  }
}

function fakeClock(): TestClock {
  let now = 1_000_000

  return {
    now: () => now,
    sleep: async () => {},
    advance: (milliseconds) => {
      now += milliseconds
    },
  }
}

function fakeMusic(playClip: (guildId: string, file: string) => Promise<boolean> = async () => true): MusicFake {
  const clips: string[] = []
  const subscriptions: string[] = []
  const views = new Map<string, QueueView | null>()
  const port: MusicPort = {
    play: async () => ({ added: 0, first: null, playlist: null, dropped: 0, total: 0 }),
    pause: async () => {},
    resume: async () => {},
    toggle: async () => false,
    skip: async () => {},
    stop: async () => {},
    shuffle: async () => {},
    remove: async () => '',
    radio: async () => false,
    view: guildId => views.get(guildId) ?? null,
    status: () => null,
    audio: {
      playClip: async (guildId, file) => {
        clips.push(file)

        return playClip(guildId, file)
      },
      async playWelcome() {},
    },
    on: (event) => {
      subscriptions.push(event)

      return () => {}
    },
    dispose: async () => {},
  }

  return {
    port,
    clips,
    subscriptions,
    setView(guildId, next) {
      views.set(guildId, next)
    },
  }
}

function fakeSpeech(options: { available?: boolean, synthesize?: (text: string) => Promise<string | null> } = {}): SpeechFake {
  const available = options.available ?? true
  const calls: string[] = []
  const files: string[] = []
  const port: SpeechPort = {
    get available() {
      return available
    },
    async synthesize(text) {
      calls.push(text)

      if (options.synthesize)
        return options.synthesize(text)

      const file = join(directory, `clip-${files.length}.mp3`)

      await writeFile(file, text)
      files.push(file)

      return file
    },
    async dispose() {},
  }

  return { port, calls, files }
}

function fakeModel(replies: readonly (CompletionReply | Promise<CompletionReply>)[]): ModelFake {
  const requests: CompletionRequest[] = []
  let index = 0
  const port: ConversationPort = {
    async complete(request) {
      requests.push(request)

      const reply = replies[index]

      index++

      return reply || { text: null, toolCalls: [] }
    },
  }

  return { port, requests }
}

function line(text = 'Una línea'): CompletionReply {
  return { text, toolCalls: [] }
}

function deferred(): { promise: Promise<CompletionReply>, resolve: (reply: CompletionReply) => void } {
  let resolve: (reply: CompletionReply) => void = () => {}

  const promise = new Promise<CompletionReply>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

function createHost(input: {
  model: ConversationPort | null
  speech: SpeechPort
  playClip?: (guildId: string, file: string) => Promise<boolean>
}): { host: OnAirHost, music: MusicFake } {
  const music = fakeMusic(input.playClip)
  const host = onAirHost({
    music: music.port,
    speech: input.speech,
    model: input.model,
    settings,
    logger: log,
    clock: fakeClock(),
  })

  return { host, music }
}

async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (!check()) {
    if (Date.now() > deadline)
      throw new Error('Timed out waiting for the host')

    await Bun.sleep(2)
  }

  // The file lands before the host registers it as prepared; let the
  // continuation that stores the clip run before the next song starts.
  await Bun.sleep(2)
}

function first<T>(values: readonly T[]): T {
  const value = values[0]

  if (value === undefined)
    throw new Error('Expected at least one value')

  return value
}

describe('beforeStream', () => {
  test('airs the first line with a long prompt and records it', async () => {
    const model = fakeModel([line('¡Dale!')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const song = track('A')

    await host.beforeStream({ guildId: 'g1', track: song, view: view({ current: song }) })

    expect(model.requests).toHaveLength(1)
    expect(music.clips).toEqual(speech.files)

    const request = first(model.requests)

    expect(request.timeoutMs).toBe(8_000)
    expect(request.maxOutputTokens).toBe(1_200)
    expect(request.reasoning).toBe('none')
    expect(request.sessionId).toBe('voice:g1')
    expect(request.messages).toEqual([{ role: 'user', content: 'Take it away.' }])
    expect(request.instructions).toContain('two sentences')
    expect(request.instructions).toContain('200')
  })

  test('airs the prepared line without calling the model again', async () => {
    const model = fakeModel([line('A'), line('B')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const [a, b] = [track('A'), track('B')]

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => model.requests.length === 2 && speech.calls.length === 2)

    await host.beforeStream({ guildId: 'g1', track: b, view: view({ current: b }) })

    expect(music.clips).toHaveLength(2)
    expect(music.clips[1]).toBe(speech.files[1])
    expect(model.requests).toHaveLength(2)
    expect(speech.calls).toHaveLength(2)

    const prepareRequest = first(model.requests.slice(1))

    expect(prepareRequest.instructions).toContain('Playing now: B')
    expect(prepareRequest.instructions).toContain('one sentence')
  })

  test('a silent slot asks for no line and prepares the song after it', async () => {
    const model = fakeModel([line('A'), line('B'), line('D')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const a = track('A')
    const b = track('B')
    const c = track('C')
    const d = track('D')

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => model.requests.length === 2 && speech.calls.length === 2)

    await host.beforeStream({ guildId: 'g1', track: b, view: view({ current: b, upcoming: [c] }) })

    expect(model.requests).toHaveLength(2)
    expect(music.clips).toHaveLength(2)

    await host.beforeStream({ guildId: 'g1', track: c, view: view({ current: c, upcoming: [d] }) })

    expect(music.clips).toHaveLength(2)
    expect(model.requests).toHaveLength(3)
    expect(model.requests[2]?.instructions).toContain('Playing now: D')

    await waitFor(() => speech.calls.length === 3)
  })

  test('a model that returns nothing is tried twice and does not use up the long slot', async () => {
    const empty: CompletionReply = { text: null, toolCalls: [] }
    const model = fakeModel([empty, empty, line('B')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const [a, b] = [track('A'), track('B')]

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a }) })

    expect(model.requests).toHaveLength(2)
    expect(speech.calls).toHaveLength(0)
    expect(music.clips).toHaveLength(0)

    await host.beforeStream({ guildId: 'g1', track: b, view: view({ current: b }) })

    expect(model.requests).toHaveLength(3)
    expect(model.requests[2]?.instructions).toContain('two sentences')
    expect(speech.calls).toHaveLength(1)
  })

  test('the line belongs to the track on the card, not to the resolved stream', async () => {
    const model = fakeModel([line('Card line')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const card = track('Card')
    const search = track('Search')

    await host.beforeStream({ guildId: 'g1', track: search, view: view({ current: card }) })

    expect(model.requests[0]?.instructions).toContain('Playing now: Card')
    expect(model.requests[0]?.instructions).not.toContain('Search')
    expect(music.clips).toHaveLength(1)

    await host.beforeStream({ guildId: 'g1', track: search, view: view({}) })

    expect(model.requests).toHaveLength(1)
    expect(music.clips).toHaveLength(1)
  })

  test('a failed playback is caught, deletes the file and leaves the long slot', async () => {
    const model = fakeModel([line('A'), line('B')])
    const speech = fakeSpeech()
    const { host, music } = createHost({
      model: model.port,
      speech: speech.port,
      playClip: async () => {
        throw new Error('the voice connection is gone')
      },
    })
    const [a, b] = [track('A'), track('B')]

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a }) })

    expect(music.clips).toHaveLength(1)
    expect(existsSync(first(speech.files))).toBe(false)

    await host.beforeStream({ guildId: 'g1', track: b, view: view({ current: b }) })

    expect(model.requests[1]?.instructions).toContain('two sentences')
  })

  test('a paused song takes no line and keeps the prepared clip', async () => {
    const model = fakeModel([line('A'), line('B')])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const [a, b] = [track('A'), track('B')]

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => speech.calls.length === 2)

    await host.beforeStream({ guildId: 'g1', track: b, view: view({ current: b, paused: true }) })

    expect(speech.calls).toHaveLength(2)
    expect(existsSync(first(speech.files.slice(1)))).toBe(true)
  })

  test('speech that is not available skips the line without asking the model', async () => {
    const model = fakeModel([line('A')])
    const speech = fakeSpeech({ available: false })
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const a = track('A')
    const b = track('B')

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a, upcoming: [b] }) })
    host.trackQueued({ guildId: 'g1', track: b, view: view({ current: a, upcoming: [b] }) })
    await Bun.sleep(5)

    expect(model.requests).toHaveLength(0)
    expect(music.clips).toHaveLength(0)
  })

  test('without a model the station stays silent', async () => {
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: null, speech: speech.port })
    const a = track('A')

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a }) })

    expect(speech.calls).toHaveLength(0)
    expect(music.clips).toHaveLength(0)
  })

  test('a speech skip airs nothing and leaves the long slot', async () => {
    const model = fakeModel([line('A'), line('B')])
    const speech = fakeSpeech({ synthesize: async () => null })
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const [a, b] = [track('A'), track('B')]

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a }) })

    expect(speech.calls).toHaveLength(1)
    expect(music.clips).toHaveLength(0)

    await host.beforeStream({ guildId: 'g1', track: b, view: view({ current: b }) })

    expect(music.clips).toHaveLength(0)
    expect(model.requests[1]?.instructions).toContain('two sentences')
  })

  test('a playlist prepares the first song it added', async () => {
    const model = fakeModel([line('A'), line('B')])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const a = track('A')
    const b = track('B')
    const c = track('C')

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a }) })
    host.playlistQueued({ guildId: 'g1', view: view({ current: a, upcoming: [b, c] }) })
    await waitFor(() => speech.calls.length === 2)

    expect(model.requests[1]?.instructions).toContain('Playing now: B')
    expect(model.requests[1]?.instructions).not.toContain('Playing now: C')
  })
})

describe('transitions', () => {
  test('a disconnect drops the prepared clip but keeps the cadence', async () => {
    const model = fakeModel([line('A'), line('B'), line('B again')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const [a, b] = [track('A'), track('B')]

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => speech.calls.length === 2)

    const prepared = first(speech.files.slice(1))

    host.disconnected('g1')
    await waitFor(() => !existsSync(prepared))

    await host.beforeStream({ guildId: 'g1', track: b, view: view({ current: b }) })

    expect(model.requests[2]?.instructions).toContain('one sentence')
    expect(music.clips).toHaveLength(2)
  })

  test('a reset drops the prepared clip and starts the cadence over', async () => {
    const model = fakeModel([line('A'), line('B'), line('B again')])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const [a, b] = [track('A'), track('B')]

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => speech.calls.length === 2)

    const prepared = first(speech.files.slice(1))

    host.reset('g1')
    await waitFor(() => !existsSync(prepared))

    await host.beforeStream({ guildId: 'g1', track: b, view: view({ current: b }) })

    expect(model.requests[2]?.instructions).toContain('two sentences')
  })

  test('a prepared clip for a song that never played is deleted', async () => {
    const model = fakeModel([line('A'), line('B'), line('C')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const a = track('A')
    const b = track('B')
    const c = track('C')

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => speech.calls.length === 2)

    const prepared = first(speech.files.slice(1))

    await host.beforeStream({ guildId: 'g1', track: c, view: view({ current: c }) })

    expect(existsSync(prepared)).toBe(false)
    expect(music.clips).toHaveLength(2)
    expect(speech.calls).toHaveLength(3)
  })

  test('a line ready after the track changed is deleted', async () => {
    const pending = deferred()
    const model = fakeModel([line('A'), pending.promise])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const a = track('A')
    const b = track('B')
    const c = track('C')

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a }) })
    host.trackQueued({ guildId: 'g1', track: b, view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => model.requests.length === 2)

    await host.beforeStream({ guildId: 'g1', track: c, view: view({ current: c, paused: true }) })

    pending.resolve(line('B line'))
    await waitFor(() => speech.calls.length === 2)

    const stale = first(speech.files.slice(1))

    await waitFor(() => !existsSync(stale))
  })

  test('one preparation runs at a time per guild', async () => {
    const pending = deferred()
    const model = fakeModel([line('A'), pending.promise])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const a = track('A')
    const b = track('B')
    const d = track('D')

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a }) })

    host.trackQueued({ guildId: 'g1', track: b, view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => model.requests.length === 2)

    host.trackQueued({ guildId: 'g1', track: d, view: view({ current: a, upcoming: [d] }) })

    expect(model.requests).toHaveLength(2)

    pending.resolve(line('B line'))
    await waitFor(() => speech.calls.length === 2)

    await host.dispose()
  })

  test('a silent slot is never prepared ahead', async () => {
    const empty: CompletionReply = { text: null, toolCalls: [] }
    const model = fakeModel([empty, empty, empty, empty])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const [a, b, d] = [track('A'), track('B'), track('D')]

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a }) })
    await host.beforeStream({ guildId: 'g1', track: b, view: view({ current: b }) })

    expect(model.requests).toHaveLength(4)

    host.trackQueued({ guildId: 'g1', track: d, view: view({ current: b, upcoming: [d] }) })
    await Bun.sleep(5)

    expect(model.requests).toHaveLength(4)
  })

  test('dispose deletes the prepared clip and can run twice', async () => {
    const model = fakeModel([line('A'), line('B')])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const [a, b] = [track('A'), track('B')]

    await host.beforeStream({ guildId: 'g1', track: a, view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => speech.calls.length === 2)

    const prepared = first(speech.files.slice(1))

    await host.dispose()

    expect(existsSync(prepared)).toBe(false)

    await host.dispose()
  })
})
