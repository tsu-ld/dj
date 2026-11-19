import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { CompletionReply, CompletionRequest, ConversationPort } from '../../ports/conversation.ts'
import type { ListenerProfile, ListenersPort } from '../../ports/listeners.ts'
import type { MusicPort, QueueView, Track } from '../../ports/music.ts'
import type { SettingsPort } from '../../ports/settings.ts'
import type { SongFacts, SongFactsPort } from '../../ports/song-facts.ts'
import type { SpeechPort } from '../../ports/speech.ts'
import type { OnAirHost } from '../host.ts'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ProviderError } from '../../core/errors.ts'
import { logger } from '../../core/logger.ts'
import { onAirHost } from '../host.ts'
import { lineTarget } from '../script.ts'

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
  // `count` syntheses were asked for and every one has finished
  settled: (count: number) => boolean
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
    requesterId: null,
    artist: null,
    fromRadio: false,
    ...extra,
  }
}

function view(input: { current?: Track | null, upcoming?: readonly Track[], paused?: boolean, radio?: boolean } = {}): QueueView {
  const current = input.current ?? null
  const upcoming = input.upcoming ?? []

  return {
    current,
    upcoming,
    paused: input.paused ?? false,
    radio: input.radio ?? false,
    size: (current ? 1 : 0) + upcoming.length,
  }
}

function fakeClock(): TestClock {
  let now = 1_000_000

  return {
    now: () => now,
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
  let running = 0
  const port: SpeechPort = {
    get available() {
      return available
    },
    release() {},
    async synthesize(text) {
      // The call is recorded when it starts, so "never synthesized" checks
      // see a synthesis that is still running.
      calls.push(text)
      running++

      try {
        if (options.synthesize)
          return await options.synthesize(text)

        const file = join(directory, `clip-${files.length}.mp3`)

        await writeFile(file, text)
        files.push(file)

        return file
      }
      finally {
        running--
      }
    },
    async dispose() {},
  }

  // Under load the file write outlasts a short sleep; waiting for the count
  // alone reads a file list that is not there yet.
  return { port, calls, files, settled: count => calls.length === count && running === 0 }
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

interface FactsFake {
  port: SongFactsPort
  lookups: string[]
  reads: string[]
}

function factsFor(title: string): SongFacts {
  return {
    artist: 'Band',
    title,
    album: `Album of ${title}`,
    year: 2001,
    releaseDate: null,
    genre: 'rock',
    artistSummary: null,
    songSummary: null,
    news: [],
  }
}

function fakeFacts(options: {
  lookup?: (title: string) => Promise<SongFacts | null>
  cached?: (title: string) => SongFacts | null
} = {}): FactsFake {
  const lookups: string[] = []
  const reads: string[] = []
  const port: SongFactsPort = {
    async lookup({ title }) {
      lookups.push(title)

      return options.lookup ? options.lookup(title) : null
    },
    cached({ title }) {
      reads.push(title)

      return options.cached ? options.cached(title) : null
    },
  }

  return { port, lookups, reads }
}

function fakeListeners(profiles: Readonly<Record<string, ListenerProfile>> = {}): ListenersPort {
  return {
    recordRequest() {},
    recordSkip() {},
    profile: (_guildId, listenerId) => profiles[listenerId] ?? null,
    flush: async () => {},
  }
}

function profile(name: string, extra: Partial<ListenerProfile> = {}): ListenerProfile {
  return { name, requests: 4, topSong: { title: 'Matador', count: 3 }, topArtists: ['Band'], skipsGiven: 1, skippedByOthers: 2, firstSeen: 0, ...extra }
}

// A store that counts like the real one: recordRequest bumps the profile.
function countingListeners(requests: number): ListenersPort & { recorded: string[] } {
  let count = requests
  const recorded: string[] = []

  return {
    recorded,
    recordRequest(_guildId, listener, song) {
      recorded.push(`${listener.id}:${song.title}`)
      count++
    },
    recordSkip() {},
    profile: (_guildId, listenerId) => listenerId === 'u1' ? profile('Ana', { requests: count, topSong: null, topArtists: [] }) : null,
    flush: async () => {},
  }
}

function captureLog(): { logger: Logger, events: (event: string) => unknown[] } {
  const lines: string[] = []

  return {
    logger: logger({ level: 'debug', sink: written => lines.push(written) }),
    events: event => lines.filter(written => written.includes(`"event":"${event}"`)).map((written): unknown => JSON.parse(written)),
  }
}

function createHost(input: {
  model: ConversationPort | null
  speech: SpeechPort
  playClip?: (guildId: string, file: string) => Promise<boolean>
  facts?: SongFactsPort
  listeners?: ListenersPort
  logger?: Logger
}): { host: OnAirHost, music: MusicFake, clock: TestClock } {
  const music = fakeMusic(input.playClip)
  const clock = fakeClock()
  const host = onAirHost({
    music: music.port,
    speech: input.speech,
    model: input.model,
    settings,
    facts: input.facts ?? fakeFacts().port,
    listeners: input.listeners ?? fakeListeners(),
    logger: input.logger ?? log,
    clock,
  })

  return { host, music, clock }
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
  test('the first line of a session is a short welcome without facts or lookups', async () => {
    const model = fakeModel([line('¡Dale!')])
    const speech = fakeSpeech()
    const facts = fakeFacts({ lookup: async title => factsFor(title), cached: factsFor })
    const listeners = fakeListeners({ u1: profile('Ana') })
    const { host, music } = createHost({ model: model.port, speech: speech.port, facts: facts.port, listeners })
    const song = track('A', { requestedBy: 'Ana', requesterId: 'u1' })

    await host.beforeStream({ guildId: 'g1', view: view({ current: song }) })

    expect(model.requests).toHaveLength(1)
    expect(music.clips).toEqual(speech.files)
    expect(facts.lookups).toEqual([])
    expect(facts.reads).toEqual([])

    const request = first(model.requests)

    expect(request.timeoutMs).toBe(8_000)
    expect(request.maxOutputTokens).toBe(1_200)
    expect(request.reasoning).toBe('none')
    expect(request.sessionId).toBe('voice:g1')
    expect(request.messages).toEqual([{ role: 'user', content: 'Open the show: a short hello and the first song.' }])
    expect(request.instructions).toContain('Angle for this line: welcome')
    expect(request.instructions).toContain(`Say one sentence, at most ${lineTarget(false)} characters.`)
    expect(request.instructions).not.toContain('<verified-facts>')
    expect(request.instructions).not.toContain('About Ana')
    expect(request.instructions).not.toContain('of this session')
  })

  test('airs the prepared line without calling the model again', async () => {
    const model = fakeModel([line('A'), line('B')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const [a, b] = [track('A'), track('B')]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => model.requests.length === 2 && speech.settled(2))

    await host.beforeStream({ guildId: 'g1', view: view({ current: b }) })

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

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b, c] }) })
    await waitFor(() => model.requests.length === 2 && speech.settled(2))

    await host.beforeStream({ guildId: 'g1', view: view({ current: b, upcoming: [c] }) })

    expect(model.requests).toHaveLength(2)
    expect(music.clips).toHaveLength(2)

    await host.beforeStream({ guildId: 'g1', view: view({ current: c, upcoming: [d] }) })

    expect(music.clips).toHaveLength(2)

    // The prepare looks the facts up before it calls the model.
    await waitFor(() => model.requests.length === 3)

    expect(model.requests).toHaveLength(3)
    expect(model.requests[2]?.instructions).toContain('Playing now: D')

    await waitFor(() => speech.settled(3))
  })

  test('a model that returns nothing is tried twice and does not use up the long slot', async () => {
    const empty: CompletionReply = { text: null, toolCalls: [] }
    const model = fakeModel([empty, empty, line('B')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const [a, b] = [track('A'), track('B')]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a }) })

    expect(model.requests).toHaveLength(2)
    expect(speech.calls).toHaveLength(0)
    expect(music.clips).toHaveLength(0)

    await host.beforeStream({ guildId: 'g1', view: view({ current: b }) })

    expect(model.requests).toHaveLength(3)
    expect(model.requests[2]?.instructions).toContain('two sentences')
    expect(speech.calls).toHaveLength(1)
  })

  test('an empty card means no line', async () => {
    const model = fakeModel([line('Card line')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })

    await host.beforeStream({ guildId: 'g1', view: view({ current: track('Card') }) })

    expect(model.requests[0]?.instructions).toContain('Playing now: Card')
    expect(music.clips).toHaveLength(1)

    await host.beforeStream({ guildId: 'g1', view: view({}) })

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

    await host.beforeStream({ guildId: 'g1', view: view({ current: a }) })

    expect(music.clips).toHaveLength(1)
    expect(existsSync(first(speech.files))).toBe(false)

    await host.beforeStream({ guildId: 'g1', view: view({ current: b }) })

    expect(model.requests[1]?.instructions).toContain('two sentences')
  })

  test('a paused song takes no line and keeps the prepared clip', async () => {
    const model = fakeModel([line('A'), line('B')])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const [a, b] = [track('A'), track('B')]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => speech.settled(2))

    await host.beforeStream({ guildId: 'g1', view: view({ current: b, paused: true }) })

    expect(speech.calls).toHaveLength(2)
    expect(existsSync(first(speech.files.slice(1)))).toBe(true)
  })

  test('speech that is not available skips the line without asking the model', async () => {
    const model = fakeModel([line('A')])
    const speech = fakeSpeech({ available: false })
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const a = track('A')
    const b = track('B')

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b] }) })
    host.trackQueued({ guildId: 'g1', track: b, view: view({ current: a, upcoming: [b] }) })
    await Bun.sleep(5)

    expect(model.requests).toHaveLength(0)
    expect(music.clips).toHaveLength(0)
  })

  test('without a model the station stays silent', async () => {
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: null, speech: speech.port })
    const a = track('A')

    await host.beforeStream({ guildId: 'g1', view: view({ current: a }) })

    expect(speech.calls).toHaveLength(0)
    expect(music.clips).toHaveLength(0)
  })

  test('a speech skip airs nothing and leaves the long slot', async () => {
    const model = fakeModel([line('A'), line('B'), line('B again')])
    const speech = fakeSpeech({ synthesize: async () => null })
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const [a, b] = [track('A', { requestedBy: 'tsu' }), track('B', { requestedBy: 'tsu' })]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a }) })

    expect(speech.calls).toHaveLength(1)
    expect(music.clips).toHaveLength(0)

    await host.beforeStream({ guildId: 'g1', view: view({ current: b }) })

    expect(music.clips).toHaveLength(0)
    expect(model.requests[1]?.instructions).toContain('two sentences')
    expect(model.requests[1]?.instructions).toContain('Who asked: requested by tsu')
  })

  test('a repeated song keeps the earlier play in the run', async () => {
    const model = fakeModel([line('A'), line('B'), line('A again')])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const [a, b, c] = [track('A'), track('B'), track('C')]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b, c, a] }) })
    await waitFor(() => model.requests.length === 2 && speech.settled(2))

    await host.beforeStream({ guildId: 'g1', view: view({ current: b, upcoming: [c, a] }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: c, upcoming: [a] }) })
    await waitFor(() => model.requests.length === 3)

    expect(model.requests[2]?.instructions).toContain('Playing now: A')

    await host.dispose()
  })

  test('a prepared line keeps the long-line cadence across the whole run', async () => {
    const model = fakeModel([line('A'), line('B'), line('D'), line('E'), line('G'), line('H')])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const tracks = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(title => track(title, { requestedBy: 'tsu' }))
    const at = (index: number) => view({ current: tracks[index], upcoming: tracks.slice(index + 1) })

    await host.beforeStream({ guildId: 'g1', view: at(0) })
    await waitFor(() => model.requests.length === 2 && speech.settled(2))

    await host.beforeStream({ guildId: 'g1', view: at(1) })
    await host.beforeStream({ guildId: 'g1', view: at(2) })
    await waitFor(() => model.requests.length === 3 && speech.settled(3))

    await host.beforeStream({ guildId: 'g1', view: at(3) })
    await waitFor(() => model.requests.length === 4 && speech.settled(4))

    await host.beforeStream({ guildId: 'g1', view: at(4) })
    await host.beforeStream({ guildId: 'g1', view: at(5) })
    await waitFor(() => model.requests.length === 5 && speech.settled(5))

    await host.beforeStream({ guildId: 'g1', view: at(6) })
    await waitFor(() => model.requests.length === 6)

    const long = model.requests[4]?.instructions ?? ''
    const short = model.requests[5]?.instructions ?? ''

    expect(long).toContain('two sentences')
    expect(long).toContain('Playing now: G')
    expect(short).not.toContain('two sentences')
    expect(short).toContain('Playing now: H')

    await host.dispose()
  })

  test('a playlist prepares the first song it added', async () => {
    const model = fakeModel([line('A'), line('B')])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const a = track('A')
    const b = track('B')
    const c = track('C')

    await host.beforeStream({ guildId: 'g1', view: view({ current: a }) })
    host.playlistQueued({ guildId: 'g1', view: view({ current: a, upcoming: [b, c] }) })
    await waitFor(() => speech.settled(2))

    expect(model.requests[1]?.instructions).toContain('Playing now: B')
    expect(model.requests[1]?.instructions).not.toContain('Playing now: C')
  })
})

describe('transitions', () => {
  test('a disconnect drops the prepared clip, welcomes again and keeps the cadence', async () => {
    const model = fakeModel([line('A'), line('B'), line('B again'), line('C')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const [a, b, c] = [track('A'), track('B'), track('C')]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => speech.settled(2))

    const prepared = first(speech.files.slice(1))

    host.disconnected('g1')
    await waitFor(() => !existsSync(prepared))

    await host.beforeStream({ guildId: 'g1', view: view({ current: b }) })

    expect(model.requests[2]?.instructions).toContain('Angle for this line: welcome')
    expect(music.clips).toHaveLength(2)

    // B took the second slot, so C is the silent third.
    await host.beforeStream({ guildId: 'g1', view: view({ current: c }) })

    expect(model.requests).toHaveLength(3)
  })

  test('a reset drops the prepared clip and starts the cadence over', async () => {
    const model = fakeModel([line('A'), line('B'), line('B again'), line('C')])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const [a, b, c] = [track('A'), track('B'), track('C')]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => speech.settled(2))

    const prepared = first(speech.files.slice(1))

    host.reset('g1')
    await waitFor(() => !existsSync(prepared))

    await host.beforeStream({ guildId: 'g1', view: view({ current: b }) })

    expect(model.requests[2]?.instructions).toContain('Angle for this line: welcome')

    // B is the first song again, so C takes the second slot and speaks.
    await host.beforeStream({ guildId: 'g1', view: view({ current: c }) })

    expect(model.requests).toHaveLength(4)
    expect(model.requests[3]?.instructions).toContain('Playing now: C')
    expect(model.requests[3]?.instructions).not.toContain('Angle for this line: welcome')
  })

  test('a prepared clip for a song that never played is deleted', async () => {
    const model = fakeModel([line('A'), line('B'), line('C')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const a = track('A')
    const b = track('B')
    const c = track('C')

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => speech.settled(2))

    const prepared = first(speech.files.slice(1))

    await host.beforeStream({ guildId: 'g1', view: view({ current: c }) })

    expect(existsSync(prepared)).toBe(false)
    expect(music.clips).toHaveLength(2)
    expect(speech.calls).toHaveLength(3)
  })

  test('a line whose song changed before synthesis is never synthesized', async () => {
    const pending = deferred()
    const model = fakeModel([line('A'), pending.promise])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const a = track('A')
    const b = track('B')
    const c = track('C')

    await host.beforeStream({ guildId: 'g1', view: view({ current: a }) })
    host.trackQueued({ guildId: 'g1', track: b, view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => model.requests.length === 2)

    await host.beforeStream({ guildId: 'g1', view: view({ current: c, paused: true }) })

    pending.resolve(line('B line'))
    await Bun.sleep(10)

    expect(model.requests).toHaveLength(2)
    expect(speech.calls).toEqual(['A'])
  })

  test('a line whose queue changed before synthesis is not synthesized and is written again', async () => {
    const pending = deferred()
    const model = fakeModel([line('A'), pending.promise, line('B after')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const [a, b, c, d] = [track('A'), track('B'), track('C'), track('D')]

    music.setView('g1', view({ current: a, upcoming: [b, c, d] }))
    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b, c, d] }) })
    await waitFor(() => model.requests.length === 2)

    const shuffled = view({ current: a, upcoming: [b, d, c] })

    music.setView('g1', shuffled)
    host.stateChanged({ guildId: 'g1', view: shuffled })
    pending.resolve(line('B before'))
    await waitFor(() => speech.settled(2))

    expect(speech.calls).toEqual(['A', 'B after'])
    expect(model.requests[2]?.instructions).toContain('Next up, in order: D | C')

    await host.beforeStream({ guildId: 'g1', view: view({ current: b, upcoming: [d, c] }) })

    expect(model.requests).toHaveLength(3)
    expect(music.clips[1]).toBe(speech.files[1])
  })

  test('one preparation runs at a time per guild', async () => {
    const pending = deferred()
    const model = fakeModel([line('A'), pending.promise])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const a = track('A')
    const b = track('B')
    const d = track('D')

    await host.beforeStream({ guildId: 'g1', view: view({ current: a }) })

    host.trackQueued({ guildId: 'g1', track: b, view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => model.requests.length === 2)

    host.trackQueued({ guildId: 'g1', track: d, view: view({ current: a, upcoming: [d] }) })

    expect(model.requests).toHaveLength(2)

    pending.resolve(line('B line'))
    await waitFor(() => speech.settled(2))

    await host.dispose()
  })

  test('a silent slot is never prepared ahead', async () => {
    const empty: CompletionReply = { text: null, toolCalls: [] }
    const model = fakeModel([empty, empty, empty, empty])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })
    const [a, b, d] = [track('A'), track('B'), track('D')]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: b }) })

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

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => speech.settled(2))

    const prepared = first(speech.files.slice(1))

    await host.dispose()

    expect(existsSync(prepared)).toBe(false)

    await host.dispose()
  })
})

describe('true facts', () => {
  test('a shuffle after preparing discards the stale clip and writes the line live', async () => {
    const model = fakeModel([line('A'), line('B before'), line('B live')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const [a, b, c, d] = [track('A'), track('B'), track('C'), track('D')]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b, c, d] }) })
    await waitFor(() => speech.settled(2))

    const stale = first(speech.files.slice(1))

    expect(model.requests[1]?.instructions).toContain('Next up, in order: C | D')

    await host.beforeStream({ guildId: 'g1', view: view({ current: b, upcoming: [d, c] }) })

    expect(existsSync(stale)).toBe(false)
    expect(model.requests).toHaveLength(3)
    expect(model.requests[2]?.instructions).toContain('Next up, in order: D | C')
    expect(speech.calls).toEqual(['A', 'B before', 'B live'])
    expect(music.clips).toEqual([first(speech.files), first(speech.files.slice(2))])
  })

  test('a shuffle prepares the line again, and an unchanged queue does not', async () => {
    const model = fakeModel([line('A'), line('B before'), line('B after')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const [a, b, c, d] = [track('A'), track('B'), track('C'), track('D')]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b, c, d] }) })
    await waitFor(() => speech.settled(2))

    const stale = first(speech.files.slice(1))
    const shuffled = view({ current: a, upcoming: [b, d, c] })

    host.stateChanged({ guildId: 'g1', view: shuffled })
    await waitFor(() => speech.settled(3) && !existsSync(stale))

    expect(model.requests[2]?.instructions).toContain('Next up, in order: D | C')

    host.stateChanged({ guildId: 'g1', view: shuffled })
    await Bun.sleep(5)

    expect(model.requests).toHaveLength(3)

    await host.beforeStream({ guildId: 'g1', view: view({ current: b, upcoming: [d, c] }) })

    expect(model.requests).toHaveLength(3)
    expect(music.clips[1]).toBe(speech.files[2])
  })

  test('a skip spends nothing until the next song, whose live line names who skipped and when', async () => {
    const model = fakeModel([line('A'), line('B'), line('B after the skip')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const [a, b] = [track('A', { requestedBy: 'tsu', requesterId: 'u1' }), track('B')]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => speech.settled(2))

    const stale = first(speech.files.slice(1))

    expect(model.requests[1]?.instructions).toContain('Last song: A, requested by tsu, played through')

    music.setView('g1', view({ current: a, upcoming: [b] }))
    host.trackSkipped({ guildId: 'g1', track: a, by: { id: 'u2', name: 'Ana' }, playedMs: 42_400 })
    await Bun.sleep(10)

    expect(model.requests).toHaveLength(2)
    expect(speech.calls).toHaveLength(2)

    await host.beforeStream({ guildId: 'g1', view: view({ current: b }) })

    const request = model.requests[2]

    expect(existsSync(stale)).toBe(false)
    expect(request?.instructions).toContain('Last song: A, requested by tsu, skipped by Ana after 42 s')
    expect(request?.instructions).toContain('Angle for this line: skip')
    expect(request?.messages[0]?.content).toContain('with the skip angle')
    expect(music.clips[1]).toBe(speech.files[2])
  })

  test('a member\'s back-to-back songs count each request once, prepared or live', async () => {
    const model = fakeModel([line('A'), line('B'), line('C'), line('D')])
    const speech = fakeSpeech()
    const listeners = countingListeners(6)
    const { host } = createHost({ model: model.port, speech: speech.port, listeners })
    const ana = { requestedBy: 'Ana', requesterId: 'u1' }
    const [a, b] = [track('A', ana), track('B', ana)]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => speech.settled(2))

    // A is request 7 and was recorded when it went on air.
    expect(model.requests[1]?.instructions).toContain('This is request number 8 from Ana')

    await host.beforeStream({ guildId: 'g1', view: view({ current: b }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('C', { fromRadio: true, requesterId: 'u1' }) }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('D', ana) }) })

    expect(listeners.recorded).toEqual(['u1:A', 'u1:B', 'u1:D'])
    expect(model.requests.at(-1)?.instructions).toContain('This is request number 9 from Ana')
  })

  test('a failed song is never back-announced', async () => {
    const model = fakeModel([line('A'), line('B'), line('C')])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port })

    await host.beforeStream({ guildId: 'g1', view: view({ current: track('A') }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('Broken') }) })
    host.playbackError({ guildId: 'g1', songId: 'Broken' })
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('C', { fromRadio: true }) }) })

    const instructions = model.requests.at(-1)?.instructions ?? ''

    expect(instructions).toContain('Playing now: C')
    expect(instructions).toContain('Last song: A')
    expect(instructions).not.toContain('Broken')
  })

  test('a failure before the next song went on air keeps the song that played', async () => {
    const model = fakeModel([line('A'), line('B'), line('C')])
    const { host } = createHost({ model: model.port, speech: fakeSpeech().port })

    await host.beforeStream({ guildId: 'g1', view: view({ current: track('A') }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('B') }) })
    host.playbackError({ guildId: 'g1', songId: 'Unmatched' })
    host.playbackError({ guildId: 'g1', songId: null })
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('C', { fromRadio: true }) }) })

    expect(model.requests.at(-1)?.instructions).toContain('Last song: B, played through')
  })

  test('turning the radio on makes a "queue ends" clip stale', async () => {
    const model = fakeModel([line('A'), line('B, last one'), line('B, radio on')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const [a, b] = [track('A'), track('B')]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a, upcoming: [b] }) })
    await waitFor(() => speech.settled(2))

    expect(model.requests[1]?.instructions).toContain('Next up: nothing, the queue ends with this song')

    await host.beforeStream({ guildId: 'g1', view: view({ current: b, radio: true }) })

    expect(model.requests).toHaveLength(3)
    expect(model.requests[2]?.instructions).toContain('When the queue runs out the radio keeps going')
    expect(model.requests[2]?.instructions).not.toContain('the queue ends')
    expect(music.clips[1]).toBe(speech.files[2])
  })

  test('a skip makes a silent slot speak, and the cadence carries on after it', async () => {
    const model = fakeModel(['A', 'B', 'C', 'D', 'E', 'F'].map(text => line(text)))
    const { host } = createHost({ model: model.port, speech: fakeSpeech().port })
    const [a, b, c, d, e, f] = [track('A'), track('B'), track('C'), track('D'), track('E'), track('F')]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: b }) })
    host.trackSkipped({ guildId: 'g1', track: b, by: { id: 'u2', name: 'Ana' }, playedMs: 5_000 })
    await host.beforeStream({ guildId: 'g1', view: view({ current: c }) })

    expect(model.requests).toHaveLength(3)
    expect(model.requests[2]?.instructions).toContain('skipped by Ana after 5 s')
    expect(model.requests[2]?.instructions).toContain('Angle for this line: skip')

    await host.beforeStream({ guildId: 'g1', view: view({ current: d }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: e }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: f }) })

    // D and E speak, F is the silent sixth.
    expect(model.requests).toHaveLength(5)
  })

  test('a skip during a line stays pending while it is still the last song', async () => {
    let open: (aired: boolean) => void = () => {}
    const gate = {
      promise: new Promise<boolean>((done) => {
        open = done
      }),
      resolve: (aired: boolean) => open(aired),
    }
    let plays = 0
    const model = fakeModel(['A', 'X', 'B', 'D'].map(text => line(text)))
    const { host } = createHost({
      model: model.port,
      speech: fakeSpeech().port,
      playClip: async () => {
        plays++

        return plays === 3 ? gate.promise : true
      },
    })
    const radio = { fromRadio: true }
    const [b, c, d] = [track('B', radio), track('C'), track('D', radio)]

    await host.beforeStream({ guildId: 'g1', view: view({ current: track('A') }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('X') }) })

    const airing = host.beforeStream({ guildId: 'g1', view: view({ current: b }) })

    await waitFor(() => plays === 3)
    host.trackSkipped({ guildId: 'g1', track: b, by: { id: 'u2', name: 'Ana' }, playedMs: 1_000 })
    // C starts while B's line still airs: no overlap, and then C fails.
    await host.beforeStream({ guildId: 'g1', view: view({ current: c }) })
    host.playbackError({ guildId: 'g1', songId: 'C' })
    gate.resolve(true)
    await airing

    expect(model.requests).toHaveLength(3)

    // D, a radio pick in the fifth slot, is silent by cadence but B's skip is still unsaid.
    await host.beforeStream({ guildId: 'g1', view: view({ current: d }) })

    expect(model.requests).toHaveLength(4)
    expect(model.requests[3]?.instructions).toContain('Last song: B, radio pick, skipped by Ana after 1 s')
  })

  test('a member with no profile yet gets the first-request milestone', async () => {
    const model = fakeModel([line('A'), line('B')])
    const { host } = createHost({ model: model.port, speech: fakeSpeech().port })

    await host.beforeStream({ guildId: 'g1', view: view({ current: track('A') }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('B', { requestedBy: 'Ana', requesterId: 'u9' }) }) })

    const instructions = model.requests[1]?.instructions ?? ''

    expect(instructions).toContain('This is request number 1 from Ana')
    expect(instructions).toContain('Angle for this line: listener')
  })

  test('a welcome after a reconnect does not back-announce the last session', async () => {
    const model = fakeModel([line('A'), line('B'), line('C')])
    const { host } = createHost({ model: model.port, speech: fakeSpeech().port })

    await host.beforeStream({ guildId: 'g1', view: view({ current: track('A') }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('B') }) })
    host.disconnected('g1')
    // A radio pick, so the third slot speaks.
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('C', { fromRadio: true }) }) })

    const instructions = model.requests[2]?.instructions ?? ''

    expect(instructions).toContain('Angle for this line: welcome')
    expect(instructions).not.toContain('Last song')
    expect(instructions).not.toContain('Earlier')
  })

  test('the same video from another member is a stale clip', async () => {
    const model = fakeModel([line('A'), line('B for Ana'), line('B for Leo')])
    const speech = fakeSpeech()
    const { host, music } = createHost({ model: model.port, speech: speech.port })
    const fromAna = track('B', { requestedBy: 'Ana', requesterId: 'u1' })
    const fromLeo = track('B', { requestedBy: 'Leo', requesterId: 'u2' })
    const c = track('C')

    await host.beforeStream({ guildId: 'g1', view: view({ current: track('A'), upcoming: [fromAna, c, fromLeo] }) })
    await waitFor(() => speech.settled(2))

    const stale = first(speech.files.slice(1))

    await host.beforeStream({ guildId: 'g1', view: view({ current: fromLeo, upcoming: [c, fromAna] }) })

    expect(existsSync(stale)).toBe(false)
    expect(model.requests[2]?.instructions).toContain('Who asked: requested by Leo')
    expect(music.clips[1]).toBe(speech.files[2])
  })

  test('a 400 skips only that line and does not pause the model', async () => {
    const requests: CompletionRequest[] = []
    const model: ConversationPort = {
      async complete(request) {
        requests.push(request)

        if (requests.length === 1)
          throw new ProviderError('language-model', 'content filter', { failure: 'fatal', status: 400 })

        return line('Next')
      },
    }
    const capture = captureLog()
    const speech = fakeSpeech()
    const { host, music } = createHost({ model, speech: speech.port, logger: capture.logger })

    await host.beforeStream({ guildId: 'g1', view: view({ current: track('A') }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('B') }) })

    expect(requests).toHaveLength(2)
    expect(music.clips).toHaveLength(1)
    expect(capture.events('on-air.model_paused')).toHaveLength(0)
  })

  test('a quota failure pauses the model like a rejected key', async () => {
    const requests: CompletionRequest[] = []
    const model: ConversationPort = {
      async complete(request) {
        requests.push(request)

        throw new ProviderError('language-model', 'no credits', { failure: 'quota', status: 402 })
      },
    }
    const { host } = createHost({ model, speech: fakeSpeech().port })

    await host.beforeStream({ guildId: 'g1', view: view({ current: track('A') }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('B') }) })

    expect(requests).toHaveLength(1)
  })

  test('a fatal model failure stops model calls for ten minutes, then they resume', async () => {
    const requests: CompletionRequest[] = []
    let failing = true
    const model: ConversationPort = {
      async complete(request) {
        requests.push(request)

        if (failing)
          throw new ProviderError('language-model', 'unauthorized', { failure: 'fatal', status: 401 })

        return line('Back on air')
      },
    }
    const capture = captureLog()
    const speech = fakeSpeech()
    const { host, music, clock } = createHost({ model, speech: speech.port, logger: capture.logger })
    const [a, b, c, d, e] = [track('A'), track('B'), track('C'), track('D'), track('E')]

    await host.beforeStream({ guildId: 'g1', view: view({ current: a }) })

    expect(requests).toHaveLength(1)

    clock.advance(10 * 60_000 - 1)
    await host.beforeStream({ guildId: 'g1', view: view({ current: b, upcoming: [d] }) })
    host.trackQueued({ guildId: 'g1', track: e, view: view({ current: b, upcoming: [e] }) })
    await Bun.sleep(5)

    expect(requests).toHaveLength(1)

    await host.beforeStream({ guildId: 'g1', view: view({ current: c }) })
    clock.advance(1)
    failing = false
    await host.beforeStream({ guildId: 'g1', view: view({ current: d }) })

    expect(requests).toHaveLength(2)
    expect(music.clips).toHaveLength(1)
    expect(capture.events('on-air.model_paused')).toHaveLength(1)
    expect(capture.events('on-air.line_failed')).toHaveLength(0)
  })

  test('on_air is logged with the spoken line only when the clip airs', async () => {
    let airs = false
    const capture = captureLog()
    const model = fakeModel([line('Hola A'), line('Hola B')])
    const speech = fakeSpeech()
    const { host } = createHost({ model: model.port, speech: speech.port, logger: capture.logger, playClip: async () => airs })

    await host.beforeStream({ guildId: 'g1', view: view({ current: track('A') }) })

    expect(capture.events('on-air.on_air')).toEqual([])
    expect(capture.events('on-air.clip_skipped')).toMatchObject([{ level: 'info', guildId: 'g1', track: 'A' }])

    airs = true
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('B') }) })

    expect(capture.events('on-air.on_air')).toMatchObject([{ level: 'info', guildId: 'g1', track: 'B', angle: 'run', line: 'Hola B' }])
  })

  test('a live line reads cached facts and never looks them up', async () => {
    const model = fakeModel([line('A'), line('B')])
    const speech = fakeSpeech()
    const facts = fakeFacts({
      lookup: async () => {
        throw new Error('a live line must not look up')
      },
      cached: factsFor,
    })
    const { host } = createHost({ model: model.port, speech: speech.port, facts: facts.port })

    await host.beforeStream({ guildId: 'g1', view: view({ current: track('A') }) })
    await host.beforeStream({ guildId: 'g1', view: view({ current: track('B') }) })

    expect(facts.lookups).toEqual([])
    expect(facts.reads).toEqual(['B'])
    expect(model.requests[1]?.instructions).toContain('These verified facts are the ONLY facts')
    expect(model.requests[1]?.instructions).toContain('Album: Album of B')
    expect(model.requests[1]?.instructions).toContain('Angle for this line: fact')
  })

  test('a prepared line waits for the looked-up facts and states them', async () => {
    let release: (facts: SongFacts | null) => void = () => {}
    const model = fakeModel([line('A'), line('B')])
    const speech = fakeSpeech()
    const facts = fakeFacts({
      lookup: async () => new Promise<SongFacts | null>((done) => {
        release = done
      }),
    })
    const { host } = createHost({ model: model.port, speech: speech.port, facts: facts.port })

    await host.beforeStream({ guildId: 'g1', view: view({ current: track('A'), upcoming: [track('B')] }) })
    await waitFor(() => facts.lookups.length === 1)

    expect(facts.lookups).toEqual(['B'])
    expect(model.requests).toHaveLength(1)

    release(factsFor('B'))
    await waitFor(() => speech.settled(2))

    expect(facts.reads).toEqual([])
    expect(model.requests[1]?.instructions).toContain('These verified facts are the ONLY facts')
    expect(model.requests[1]?.instructions).toContain('Album: Album of B')
  })

  test('the requester profile reaches the prompt, a radio pick gets none', async () => {
    const model = fakeModel([line('A'), line('B'), line('C')])
    const speech = fakeSpeech()
    const listeners = fakeListeners({ u1: profile('Ana') })
    const { host } = createHost({ model: model.port, speech: speech.port, listeners })
    const b = track('B', { requestedBy: 'Ana', requesterId: 'u1' })
    const c = track('C', { requestedBy: 'Ana', requesterId: 'u1', fromRadio: true })

    await host.beforeStream({ guildId: 'g1', view: view({ current: track('A'), upcoming: [b] }) })
    await waitFor(() => speech.settled(2))

    const instructions = model.requests[1]?.instructions ?? ''

    expect(instructions).toContain('About Ana, who asked for this song:')
    expect(instructions).toContain('This is request number 5 from Ana')
    expect(instructions).toContain('Most requested song so far: Matador (3 times)')
    expect(instructions).toContain('Angle for this line: listener')

    await host.beforeStream({ guildId: 'g1', view: view({ current: b }) })
    // C is the third song, but a radio pick speaks on the third slot.
    await host.beforeStream({ guildId: 'g1', view: view({ current: c }) })

    expect(model.requests[2]?.instructions).toContain('Playing now: C')
    expect(model.requests[2]?.instructions).not.toContain('About Ana')
  })

  test('a started song prefetches facts for the next three and ignores failures', async () => {
    const facts = fakeFacts({
      lookup: async () => {
        throw new Error('offline')
      },
    })
    const { host } = createHost({ model: fakeModel([]).port, speech: fakeSpeech().port, facts: facts.port })
    const [a, b, c, d, e] = [track('A'), track('B'), track('C'), track('D'), track('E')]

    host.trackStarted({ guildId: 'g1', view: view({ current: a, upcoming: [b, c, d, e] }) })
    await Bun.sleep(5)

    expect(facts.lookups).toEqual(['B', 'C', 'D'])
  })
})
