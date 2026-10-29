import type { VoiceBasedChannel } from 'discord.js'
import type { AudioPlayerLike, VoiceAccess, VoiceConnectionLike, VoiceSession } from '../welcome.ts'
import { EventEmitter } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { audioOverMusic } from '../welcome.ts'
import { log, tempDir } from './helpers.ts'

interface FakePlayer extends AudioPlayerLike {
  readonly pauses: number
  emit: (event: string, ...args: unknown[]) => boolean
  setStatus: (status: string) => void
}

interface FakeConnection extends VoiceConnectionLike {
  readonly subscriptions: readonly unknown[]
  readonly current: unknown
  emit: (event: string, ...args: unknown[]) => boolean
  setStatus: (status: string) => void
}

function fakePlayer(options: { onPlay?: (player: FakePlayer) => void, onStop?: (player: FakePlayer) => void } = {}): FakePlayer {
  const emitter = new EventEmitter()
  const state = { status: 'autopaused' }
  let pauses = 0

  const player: FakePlayer = {
    get state() {
      return state
    },
    get pauses() {
      return pauses
    },
    setStatus(status) {
      state.status = status
    },
    on(event, listener) {
      emitter.on(event, listener)

      return player
    },
    once(event, listener) {
      emitter.once(event, listener)

      return player
    },
    off(event, listener) {
      emitter.off(event, listener)

      return player
    },
    play() {
      options.onPlay?.(player)
    },
    stop() {
      options.onStop?.(player)
    },
    pause() {
      pauses++
      state.status = 'paused'
    },
    emit(event, ...args) {
      return emitter.emit(event, ...args)
    },
  }

  return player
}

function fakeConnection(): { connection: FakeConnection, audioPlayer: FakePlayer } {
  const emitter = new EventEmitter()
  const state = { status: 'ready' }
  const subscriptions: unknown[] = []
  let current: unknown = null

  const connection: FakeConnection = {
    get state() {
      return state
    },
    get subscriptions() {
      return subscriptions
    },
    get current() {
      return current
    },
    setStatus(status) {
      state.status = status
    },
    on(event, listener) {
      emitter.on(event, listener)

      return connection
    },
    once(event, listener) {
      emitter.once(event, listener)

      return connection
    },
    off(event, listener) {
      emitter.off(event, listener)

      return connection
    },
    subscribe(player) {
      subscriptions.push(player)
      current = player
    },
    emit(event, ...args) {
      return emitter.emit(event, ...args)
    },
  }

  return { connection, audioPlayer: fakePlayer() }
}

function accessOf(
  voice: VoiceSession | null,
  queue: { songs: readonly unknown[], paused: boolean } | null = { songs: [{ name: 'Tema' }], paused: false },
  join?: VoiceAccess['join'],
): VoiceAccess {
  return {
    voice: () => voice,
    queue: () => queue,
    join: join ?? (async () => {
      throw new Error('join was not expected')
    }),
  }
}

function fakeChannel(id = 'guild-1'): VoiceBasedChannel {
  // Test double for the SDK's channel handle: the audio code only reads the
  // guild id before it hands the channel back to the voice access seam.
  return { guild: { id } } as unknown as VoiceBasedChannel
}

async function tempAudio(): Promise<{ file: string, cleanup: () => Promise<void> }> {
  const { dir, cleanup } = await tempDir()
  const file = join(dir, 'line.mp3')

  await writeFile(file, 'fake audio')

  return { file, cleanup }
}

test('the line takes the connection and hands it back to the music', async () => {
  const { file, cleanup } = await tempAudio()
  const session = fakeConnection()
  const speech = fakePlayer({ onPlay: player => queueMicrotask(() => player.emit('idle')) })
  const audio = audioOverMusic({
    access: accessOf({ connection: session.connection, audioPlayer: session.audioPlayer }),
    logger: log,
    createResource: () => ({}),
    createPlayer: () => speech,
  })

  try {
    const spoken = await audio.playClip('g1', file)

    expect(spoken).toBe(true)
    expect(session.connection.subscriptions).toEqual([speech, session.audioPlayer])
    expect(session.connection.current).toBe(session.audioPlayer)
  }
  finally {
    await audio.dispose()
    await cleanup()
  }
})

test('without a voice connection nothing is spoken', async () => {
  const { file, cleanup } = await tempAudio()
  const audio = audioOverMusic({ access: accessOf(null), logger: log })

  try {
    expect(await audio.playClip('g2', file)).toBe(false)
  }
  finally {
    await audio.dispose()
    await cleanup()
  }
})

test('an empty queue never gets a line', async () => {
  const { file, cleanup } = await tempAudio()
  const session = fakeConnection()
  const audio = audioOverMusic({
    access: accessOf({ connection: session.connection, audioPlayer: session.audioPlayer }, { songs: [], paused: false }),
    logger: log,
    createResource: () => ({}),
  })

  try {
    expect(await audio.playClip('g3', file)).toBe(false)
    expect(session.connection.subscriptions).toEqual([])
  }
  finally {
    await audio.dispose()
    await cleanup()
  }
})

test('a missing clip is skipped without taking the process down', async () => {
  const session = fakeConnection()
  const audio = audioOverMusic({
    access: accessOf({ connection: session.connection, audioPlayer: session.audioPlayer }),
    logger: log,
    createResource: () => ({}),
    createPlayer: () => fakePlayer(),
  })

  try {
    expect(await audio.playClip('g9', join(tmpdir(), 'dj-missing-clip-does-not-exist.mp3'))).toBe(false)
    expect(session.connection.current).toBe(session.audioPlayer)
  }
  finally {
    await audio.dispose()
  }
})

test('a paused queue is left alone', async () => {
  const { file, cleanup } = await tempAudio()
  const session = fakeConnection()
  const audio = audioOverMusic({
    access: accessOf({ connection: session.connection, audioPlayer: session.audioPlayer }, { songs: [{ name: 'Tema' }], paused: true }),
    logger: log,
    createResource: () => ({}),
  })

  try {
    expect(await audio.playClip('g5', file)).toBe(false)
    expect(session.connection.subscriptions).toEqual([])
  }
  finally {
    await audio.dispose()
    await cleanup()
  }
})

test('a connection that dies mid-line is not given back to the music', async () => {
  const { file, cleanup } = await tempAudio()
  const session = fakeConnection()
  const speech = fakePlayer({ onStop: player => player.emit('idle') })
  const audio = audioOverMusic({
    access: accessOf({ connection: session.connection, audioPlayer: session.audioPlayer }),
    logger: log,
    createResource: () => ({}),
    createPlayer: () => speech,
  })

  try {
    const spoken = audio.playClip('g6', file)

    session.connection.setStatus('destroyed')
    session.connection.emit('destroyed')

    expect(await spoken).toBe(true)
    expect(session.connection.subscriptions).toEqual([speech])
  }
  finally {
    await audio.dispose()
    await cleanup()
  }
})

test('a pause pressed during the line is applied when the music is back', async () => {
  const { file, cleanup } = await tempAudio()
  const session = fakeConnection()
  const queue = { songs: [{ name: 'Tema' }], paused: false }
  let release = (): void => {}
  const speech = fakePlayer({
    onPlay: (player) => {
      release = () => player.emit('idle')
    },
  })
  const audio = audioOverMusic({
    access: accessOf({ connection: session.connection, audioPlayer: session.audioPlayer }, queue),
    logger: log,
    createResource: () => ({}),
    createPlayer: () => speech,
  })

  try {
    const line = audio.playClip('g7', file)

    queue.paused = true
    release()
    await line

    expect(session.audioPlayer.pauses).toBe(0)

    session.audioPlayer.emit('playing')

    expect(session.audioPlayer.pauses).toBe(1)
  }
  finally {
    await audio.dispose()
    await cleanup()
  }
})

test('resuming during the line keeps the pause from coming back', async () => {
  const { file, cleanup } = await tempAudio()
  const session = fakeConnection()
  const queue = { songs: [{ name: 'Tema' }], paused: false }
  let release = (): void => {}
  const speech = fakePlayer({
    onPlay: (player) => {
      release = () => player.emit('idle')
    },
  })
  const audio = audioOverMusic({
    access: accessOf({ connection: session.connection, audioPlayer: session.audioPlayer }, queue),
    logger: log,
    createResource: () => ({}),
    createPlayer: () => speech,
  })

  try {
    const line = audio.playClip('g8', file)

    queue.paused = true
    queue.paused = false
    release()
    await line

    session.audioPlayer.emit('playing')

    expect(session.audioPlayer.pauses).toBe(0)
  }
  finally {
    await audio.dispose()
    await cleanup()
  }
})

test('a second line does not cut the one already on air', async () => {
  const { file, cleanup } = await tempAudio()
  const session = fakeConnection()
  let release = (): void => {}
  const speech = fakePlayer({
    onPlay: (player) => {
      release = () => player.emit('idle')
    },
  })
  const audio = audioOverMusic({
    access: accessOf({ connection: session.connection, audioPlayer: session.audioPlayer }),
    logger: log,
    createResource: () => ({}),
    createPlayer: () => speech,
  })

  try {
    const first = audio.playClip('g4', file)
    const second = await audio.playClip('g4', file)

    expect(second).toBe(false)

    release()

    expect(await first).toBe(true)
  }
  finally {
    await audio.dispose()
    await cleanup()
  }
})

test('a failed clip settles on the player error instead of waiting for idle', async () => {
  const { file, cleanup } = await tempAudio()
  const session = fakeConnection()
  const speech = fakePlayer({ onPlay: player => player.emit('error', new Error('boom')) })
  const audio = audioOverMusic({
    access: accessOf({ connection: session.connection, audioPlayer: session.audioPlayer }),
    logger: log,
    createResource: () => ({}),
    createPlayer: () => speech,
  })

  try {
    expect(await audio.playClip('g9', file)).toBe(false)
    expect(session.connection.subscriptions).toEqual([speech, session.audioPlayer])
  }
  finally {
    await audio.dispose()
    await cleanup()
  }
})

test('dispose settles a clip that never reaches idle', async () => {
  const { file, cleanup } = await tempAudio()
  const session = fakeConnection()
  const speech = fakePlayer()
  const audio = audioOverMusic({
    access: accessOf({ connection: session.connection, audioPlayer: session.audioPlayer }),
    logger: log,
    createResource: () => ({}),
    createPlayer: () => speech,
  })

  try {
    const clip = audio.playClip('g10', file)

    await new Promise(resolve => setTimeout(resolve, 10))
    await audio.dispose()

    expect(await clip).toBe(false)
  }
  finally {
    await cleanup()
  }
})

test('the welcome intro plays once per guild and hands the connection back', async () => {
  const { file, cleanup } = await tempAudio()
  const session = fakeConnection()
  const intro = fakePlayer({ onPlay: player => queueMicrotask(() => player.emit('idle')) })
  let joins = 0
  const audio = audioOverMusic({
    access: accessOf(null, undefined, async () => {
      joins++

      return { connection: session.connection, audioPlayer: session.audioPlayer }
    }),
    logger: log,
    createResource: () => ({}),
    welcomeFile: file,
    createPlayer: () => intro,
  })

  try {
    await audio.playWelcome(fakeChannel())
    await audio.playWelcome(fakeChannel())

    expect(joins).toBe(1)
    expect(session.connection.subscriptions).toEqual([intro, session.audioPlayer])
  }
  finally {
    await audio.dispose()
    await cleanup()
  }
})

test('without a welcome file the bot joins nothing', async () => {
  const { dir, cleanup } = await tempDir()
  let joins = 0
  const audio = audioOverMusic({
    access: accessOf(null, undefined, async () => {
      joins++

      return fakeConnection()
    }),
    logger: log,
    createResource: () => ({}),
    welcomeFile: join(dir, 'missing.mp3'),
  })

  try {
    await audio.playWelcome(fakeChannel())

    expect(joins).toBe(0)
  }
  finally {
    await audio.dispose()
    await cleanup()
  }
})

test('a destroyed connection during the intro is not given to the music', async () => {
  const { file, cleanup } = await tempAudio()
  const session = fakeConnection()
  const intro = fakePlayer()
  const audio = audioOverMusic({
    access: accessOf(null, undefined, async () => ({ connection: session.connection, audioPlayer: session.audioPlayer })),
    logger: log,
    createResource: () => ({}),
    welcomeFile: file,
    createPlayer: () => intro,
  })

  try {
    const welcome = audio.playWelcome(fakeChannel())

    session.connection.setStatus('destroyed')
    session.connection.emit('destroyed')
    await welcome

    expect(session.connection.subscriptions).toEqual([intro])
  }
  finally {
    await audio.dispose()
    await cleanup()
  }
})

test('a failed join does not use up the greeting', async () => {
  const { file, cleanup } = await tempAudio()
  const session = fakeConnection()
  let joins = 0
  const audio = audioOverMusic({
    access: accessOf(null, undefined, async () => {
      joins++

      if (joins === 1)
        throw new Error('join failed')

      return { connection: session.connection, audioPlayer: session.audioPlayer }
    }),
    logger: log,
    createResource: () => ({}),
    welcomeFile: file,
    createPlayer: () => fakePlayer({ onPlay: player => queueMicrotask(() => player.emit('idle')) }),
  })

  try {
    await audio.playWelcome(fakeChannel())
    await audio.playWelcome(fakeChannel())

    expect(joins).toBe(2)
  }
  finally {
    await audio.dispose()
    await cleanup()
  }
})
