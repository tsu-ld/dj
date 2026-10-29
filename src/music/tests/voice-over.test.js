import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { playOverMusic } from '../voice-over.js'

function fakeConnection() {
  const connection = new EventEmitter()
  const audioPlayer = new EventEmitter()

  audioPlayer.state = { status: 'autopaused' }
  audioPlayer.pauses = 0
  audioPlayer.pause = () => {
    audioPlayer.pauses++
    audioPlayer.state = { status: 'paused' }
  }

  connection.state = { status: 'ready' }
  connection.subscriptions = []
  connection.subscribe = (player) => {
    connection.subscriptions.push(player)
    connection.current = player
  }

  return { connection, audioPlayer }
}

function fakeSpeechPlayer(when = 'idle') {
  const player = new EventEmitter()

  player.play = () => {
    if (when === 'idle')
      queueMicrotask(() => player.emit('idle'))
  }
  player.stop = () => {}

  return player
}

function fakePlayer(voice, queue = { songs: [{ name: 'Tema' }] }) {
  return {
    voices: { get: () => voice },
    getQueue: () => queue,
  }
}

async function tempFile() {
  const dir = await mkdtemp(join(tmpdir(), 'dj-voice-test-'))
  const file = join(dir, 'line.mp3')

  await writeFile(file, 'fake audio')

  return { file, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

test('the line takes the connection and hands it back to distube', async () => {
  const { file, cleanup } = await tempFile()
  const voice = fakeConnection()
  const speech = fakeSpeechPlayer()

  try {
    const spoken = await playOverMusic('g1', file, { player: fakePlayer(voice), createPlayer: () => speech })

    expect(spoken).toBe(true)
    expect(voice.connection.subscriptions).toEqual([speech, voice.audioPlayer])
    expect(voice.connection.current).toBe(voice.audioPlayer)
  }
  finally {
    await cleanup()
  }
})

test('without a voice connection nothing is spoken', async () => {
  const { file, cleanup } = await tempFile()

  try {
    expect(await playOverMusic('g2', file, { player: fakePlayer(null) })).toBe(false)
  }
  finally {
    await cleanup()
  }
})

test('an empty queue never gets a line', async () => {
  const { file, cleanup } = await tempFile()
  const voice = fakeConnection()

  try {
    expect(await playOverMusic('g3', file, { player: fakePlayer(voice, { songs: [] }) })).toBe(false)
    expect(voice.connection.subscriptions).toEqual([])
  }
  finally {
    await cleanup()
  }
})

test('a paused queue is left alone', async () => {
  const { file, cleanup } = await tempFile()
  const voice = fakeConnection()

  try {
    expect(await playOverMusic('g5', file, { player: fakePlayer(voice, { songs: [{ name: 'Tema' }], paused: true }) })).toBe(false)
    expect(voice.connection.subscriptions).toEqual([])
  }
  finally {
    await cleanup()
  }
})

test('a connection that dies mid-line is not given back to distube', async () => {
  const { file, cleanup } = await tempFile()
  const voice = fakeConnection()
  const speech = new EventEmitter()

  speech.play = () => {}
  speech.stop = () => speech.emit('idle')

  try {
    const spoken = playOverMusic('g6', file, { player: fakePlayer(voice), createPlayer: () => speech })

    voice.connection.state = { status: 'destroyed' }
    voice.connection.emit('destroyed')

    expect(await spoken).toBe(true)
    expect(voice.connection.subscriptions).toEqual([speech])
  }
  finally {
    await cleanup()
  }
})

test('a pause pressed during the line is applied when the music is back', async () => {
  const { file, cleanup } = await tempFile()
  const voice = fakeConnection()
  const queue = { songs: [{ name: 'Tema' }], paused: false }
  const music = { voices: { get: () => voice }, getQueue: () => queue }
  let release
  const speech = new EventEmitter()

  speech.play = () => {
    release = () => speech.emit('idle')
  }
  speech.stop = () => {}

  try {
    const line = playOverMusic('g7', file, { player: music, createPlayer: () => speech })

    queue.paused = true
    release()
    await line

    expect(voice.audioPlayer.pauses).toBe(0)

    voice.audioPlayer.emit('playing')

    expect(voice.audioPlayer.pauses).toBe(1)
  }
  finally {
    await cleanup()
  }
})

test('resuming during the line keeps the pause from coming back', async () => {
  const { file, cleanup } = await tempFile()
  const voice = fakeConnection()
  const queue = { songs: [{ name: 'Tema' }], paused: false }
  const music = { voices: { get: () => voice }, getQueue: () => queue }
  let release
  const speech = new EventEmitter()

  speech.play = () => {
    release = () => speech.emit('idle')
  }
  speech.stop = () => {}

  try {
    const line = playOverMusic('g8', file, { player: music, createPlayer: () => speech })

    queue.paused = true
    queue.paused = false
    release()
    await line

    voice.audioPlayer.emit('playing')

    expect(voice.audioPlayer.pauses).toBe(0)
  }
  finally {
    await cleanup()
  }
})

test('a second line does not cut the one already on air', async () => {
  const { file, cleanup } = await tempFile()
  const voice = fakeConnection()
  let release
  const speech = new EventEmitter()

  speech.play = () => {
    release = () => speech.emit('idle')
  }
  speech.stop = () => {}

  try {
    const first = playOverMusic('g4', file, { player: fakePlayer(voice), createPlayer: () => speech })

    expect(await playOverMusic('g4', file, { player: fakePlayer(voice), createPlayer: () => fakeSpeechPlayer() })).toBe(false)

    release()
    expect(await first).toBe(true)
  }
  finally {
    await cleanup()
  }
})
