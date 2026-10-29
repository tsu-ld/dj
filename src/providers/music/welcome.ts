import type { VoiceBasedChannel } from 'discord.js'
import type { Readable } from 'node:stream'
import type { Logger } from '../../core/logger.ts'
import type { AudioPlayerLike, MusicAudio, VoiceAccess, VoiceSession } from './audio-types.ts'
import { createReadStream, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { AudioPlayerStatus, createAudioPlayer, createAudioResource, VoiceConnectionStatus } from '@discordjs/voice'
import { errorMessage } from '../../core/errors.ts'
import { waitForAudio } from './audio-wait.ts'

export type { AudioPlayerLike, MusicAudio, VoiceAccess, VoiceConnectionLike, VoiceSession } from './audio-types.ts'

const SPEECH_TIMEOUT_MS = 30_000
const INTRO_TIMEOUT_MS = 30_000
const WELCOME_FILE = resolve(import.meta.dirname, '../../../assets/welcome.mp3')

export function audioOverMusic(deps: {
  access: VoiceAccess
  logger: Logger
  welcomeFile?: string
  createPlayer?: () => AudioPlayerLike
  createResource?: (stream: Readable) => unknown
}): MusicAudio {
  const { access, logger } = deps
  const createResource = deps.createResource ?? ((stream: Readable): unknown => createAudioResource(stream))
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

        const stream = createReadStream(filePath)

        // The clip is a temp file: a concurrent cleanup or a crash can remove it
        // between synthesis and playback. Settle the wait instead of letting the
        // stream's unhandled error take the process down.
        stream.once('error', (error) => {
          logger.warn('music.clip_unreadable', { guildId, error: errorMessage(error) })
          attempt.abort()
        })
        player.play(createResource(stream))

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

      const stream = createReadStream(welcomeFile)

      stream.once('error', (error) => {
        logger.warn('music.welcome_unreadable', { guildId: channel.guild.id, error: errorMessage(error) })
        attempt.abort()
      })
      player.play(createResource(stream))

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
