import type { VoiceBasedChannel } from 'discord.js'
import type { Logger } from '../../core/logger.ts'
import type { AudioOverMusic } from '../../ports/music.ts'
import { createReadStream, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { AudioPlayerStatus, createAudioPlayer, createAudioResource, VoiceConnectionStatus } from '@discordjs/voice'

const SPEECH_TIMEOUT_MS = 30_000
const INTRO_TIMEOUT_MS = 30_000
const WELCOME_FILE = resolve(import.meta.dirname, '../../../assets/welcome.mp3')

// The SDK's players and connections declare their emitters as methods: turning
// them into function properties makes their parameters contravariant and rejects
// the real objects at the seam.
/* eslint-disable ts/method-signature-style */
export interface AudioPlayerLike {
  readonly state: { readonly status: string }
  on(event: string, listener: (...args: unknown[]) => void): unknown
  once(event: string, listener: (...args: unknown[]) => void): unknown
  off(event: string, listener: (...args: unknown[]) => void): unknown
  play(resource: unknown): unknown
  stop(force?: boolean): unknown
  pause(): unknown
}

export interface VoiceConnectionLike {
  readonly state: { readonly status: string }
  on(event: string, listener: (...args: unknown[]) => void): unknown
  once(event: string, listener: (...args: unknown[]) => void): unknown
  off(event: string, listener: (...args: unknown[]) => void): unknown
  subscribe(player: AudioPlayerLike): unknown
}
/* eslint-enable ts/method-signature-style */

export interface VoiceSession {
  readonly connection: VoiceConnectionLike
  readonly audioPlayer: AudioPlayerLike
}

export interface VoiceAccess {
  readonly voice: (guildId: string) => VoiceSession | null
  readonly queue: (guildId: string) => { readonly songs: readonly unknown[], readonly paused: boolean } | null
  readonly join: (channel: VoiceBasedChannel) => Promise<VoiceSession>
}

export interface MusicAudio extends AudioOverMusic {
  readonly playWelcome: (channel: VoiceBasedChannel) => Promise<void>
  readonly dispose: () => Promise<void>
}

type AudioOutcome = 'idle' | 'error' | 'destroyed' | 'timeout' | 'aborted'

// A connection plays one stream at a time, so a line or the intro takes the
// connection while the music holds its position: the SDK's player pauses itself
// when it loses the subscriber and resumes when it gets it back. Queue state is
// never touched, so the now-playing card keeps saying "Playing".
async function waitForAudio(
  player: AudioPlayerLike,
  connection: VoiceConnectionLike,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<AudioOutcome> {
  return new Promise((resolveOutcome) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    function finish(outcome: AudioOutcome): void {
      if (settled)
        return

      settled = true
      clearTimeout(timer)
      player.off(AudioPlayerStatus.Idle, onIdle)
      player.off('error', onError)
      connection.off(VoiceConnectionStatus.Destroyed, onDestroyed)
      signal.removeEventListener('abort', onAbort)
      resolveOutcome(outcome)
    }

    function onIdle(): void {
      finish('idle')
    }

    function onError(): void {
      finish('error')
    }

    function onDestroyed(): void {
      finish('destroyed')
    }

    function onAbort(): void {
      finish('aborted')
    }

    timer = setTimeout(() => finish('timeout'), timeoutMs)

    player.on(AudioPlayerStatus.Idle, onIdle)
    player.on('error', onError)
    connection.on(VoiceConnectionStatus.Destroyed, onDestroyed)
    signal.addEventListener('abort', onAbort, { once: true })

    if (signal.aborted)
      onAbort()
    else if (connection.state.status === VoiceConnectionStatus.Destroyed)
      onDestroyed()
  })
}

export function audioOverMusic(deps: {
  access: VoiceAccess
  logger: Logger
  welcomeFile?: string
  createPlayer?: () => AudioPlayerLike
}): MusicAudio {
  const { access, logger } = deps
  const welcomeFile = deps.welcomeFile ?? WELCOME_FILE
  const hasWelcome = existsSync(welcomeFile)
  const createPlayer = deps.createPlayer ?? ((): AudioPlayerLike => createAudioPlayer())
  const speaking = new Set<string>()
  const greeted = new Set<string>()
  const pending = new Set<Promise<unknown>>()
  const abort = new AbortController()
  let disposed = false

  async function track<T>(task: Promise<T>): Promise<T> {
    pending.add(task)
    void task.finally(() => pending.delete(task)).catch(() => {})

    return task
  }

  async function playClip(guildId: string, filePath: string): Promise<boolean> {
    if (disposed || speaking.has(guildId))
      return false

    const voice = access.voice(guildId)
    const queue = access.queue(guildId)

    if (voice === null || queue === null || queue.songs.length === 0 || queue.paused)
      return false

    speaking.add(guildId)

    const player = createPlayer()
    const stopSpeech = (): void => {
      player.stop(true)
    }

    voice.connection.once(VoiceConnectionStatus.Destroyed, stopSpeech)

    return track((async (): Promise<boolean> => {
      const attempt = new AbortController()

      try {
        const waiting = waitForAudio(
          player,
          voice.connection,
          SPEECH_TIMEOUT_MS,
          AbortSignal.any([abort.signal, attempt.signal]),
        )

        voice.connection.subscribe(player)
        player.play(createAudioResource(createReadStream(filePath)))

        const outcome = await waiting

        if (outcome === 'error' || outcome === 'timeout' || outcome === 'aborted')
          logger.warn('music.line_failed', { guildId, outcome })

        return outcome === 'idle' || outcome === 'destroyed'
      }
      catch (error) {
        attempt.abort()
        logger.error('music.line_failed', error, { guildId })

        return false
      }
      finally {
        attempt.abort()
        voice.connection.off(VoiceConnectionStatus.Destroyed, stopSpeech)
        player.stop(true)

        if (voice.connection.state.status !== VoiceConnectionStatus.Destroyed) {
          voice.connection.subscribe(voice.audioPlayer)

          // A pause pressed while the line held the connection never reached the
          // music player; apply it once the music is playing again.
          const pauseIfStillPaused = (): void => {
            if (access.queue(guildId)?.paused)
              voice.audioPlayer.pause()
          }

          if (access.queue(guildId)?.paused) {
            if (voice.audioPlayer.state.status === AudioPlayerStatus.Playing)
              pauseIfStillPaused()
            else
              voice.audioPlayer.once(AudioPlayerStatus.Playing, pauseIfStillPaused)
          }
        }

        speaking.delete(guildId)
      }
    })())
  }

  // The intro runs on its own player and the connection is handed back when it
  // ends. Playing it through the music player makes the SDK read the intro's
  // idle state as the requested song finishing: it drops the song from the
  // queue and leaves the channel before the extractor has finished downloading.
  async function playWelcome(channel: VoiceBasedChannel): Promise<void> {
    if (disposed || !hasWelcome || greeted.has(channel.guild.id))
      return

    greeted.add(channel.guild.id)

    let voice: VoiceSession

    try {
      voice = await access.join(channel)
    }
    catch (error) {
      greeted.delete(channel.guild.id)
      logger.error('music.welcome_failed', error, { guildId: channel.guild.id })

      return
    }

    if (disposed)
      return

    const player = createPlayer()
    // A destroyed connection unsubscribes the player, which autopauses it and
    // never reaches idle on its own; the wait listens for it directly.
    const stopIntro = (): void => {
      player.stop(true)
    }

    voice.connection.once(VoiceConnectionStatus.Destroyed, stopIntro)

    const attempt = new AbortController()

    try {
      const waiting = waitForAudio(
        player,
        voice.connection,
        INTRO_TIMEOUT_MS,
        AbortSignal.any([abort.signal, attempt.signal]),
      )

      voice.connection.subscribe(player)
      player.play(createAudioResource(createReadStream(welcomeFile)))

      const outcome = await waiting

      if (outcome === 'error' || outcome === 'timeout' || outcome === 'aborted')
        logger.warn('music.welcome_settled_early', { guildId: channel.guild.id, outcome })
    }
    catch (error) {
      attempt.abort()
      logger.error('music.welcome_failed', error, { guildId: channel.guild.id })
    }
    finally {
      attempt.abort()
      voice.connection.off(VoiceConnectionStatus.Destroyed, stopIntro)
      player.stop(true)

      if (voice.connection.state.status !== VoiceConnectionStatus.Destroyed)
        voice.connection.subscribe(voice.audioPlayer)
    }
  }

  async function dispose(): Promise<void> {
    if (disposed)
      return

    disposed = true
    abort.abort()
    speaking.clear()
    greeted.clear()

    await Promise.allSettled([...pending])
  }

  return { playClip, playWelcome, dispose }
}
