import type { VoiceBasedChannel } from 'discord.js'
import type { Readable } from 'node:stream'
import type { Logger } from '../../core/logger.ts'
import type {
  AudioPlayerLike,
  MusicAudio,
  VoiceAccess,
  VoiceConnectionLike,
  VoiceSession,
} from './audio-types.ts'
import { createReadStream, existsSync } from 'node:fs'
import { AudioPlayerStatus, VoiceConnectionStatus } from '@discordjs/voice'
import { errorMessage } from '../../core/errors.ts'

const SPEECH_TIMEOUT_MS = 30_000
const INTRO_TIMEOUT_MS = 30_000

type AudioOutcome = 'idle' | 'error' | 'destroyed' | 'timeout' | 'aborted'

export function audioOverMusic<Resource>(deps: {
  access: VoiceAccess
  logger: Logger
  welcomeFile: string
  createPlayer: () => AudioPlayerLike<Resource>
  createResource: (stream: Readable) => Resource
}): MusicAudio {
  const { access, logger, welcomeFile, createPlayer, createResource } = deps
  const hasWelcome = existsSync(welcomeFile)
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

  async function playThrough(
    voice: VoiceSession,
    guildId: string,
    filePath: string,
    timeoutMs: number,
    events: { readonly unreadable: string; readonly settledEarly: string },
  ): Promise<boolean> {
    // WORKAROUND(https://github.com/skick1234/DisTube/blob/5.2.3/src/core/DisTubeVoice.ts#L45): distube emits finish on any idle of its own player, then drops the song and may leave; lines play on a separate player. Goes when distube ignores idles it did not start.
    const player = createPlayer()
    // WORKAROUND(https://github.com/discordjs/discord.js/blob/%40discordjs/voice%400.19.2/packages/voice/src/audio/AudioPlayer.ts#L557-L569): a destroy autopauses the player for good, so it never idles; it is stopped on destroy. Goes when a destroy idles it.
    const stopPlayer = (): void => {
      player.stop(true)
    }
    const attempt = new AbortController()

    try {
      const waiting = waitForAudio(
        player,
        voice.connection,
        timeoutMs,
        AbortSignal.any([abort.signal, attempt.signal]),
      )

      // WORKAROUND(https://github.com/discordjs/discord.js/blob/%40discordjs/voice%400.19.2/packages/voice/src/audio/AudioPlayer.ts#L492): stop() emits idle, which the wait would read as played; this listener comes after the wait's. Goes when stop() emits no idle.
      voice.connection.once(VoiceConnectionStatus.Destroyed, stopPlayer)

      voice.connection.subscribe(player)

      const stream = createReadStream(filePath)

      stream.once('error', (error) => {
        logger.warn(events.unreadable, { guildId, error: errorMessage(error) })
        attempt.abort()
      })
      player.play(createResource(stream))

      const outcome = await waiting

      if (outcome === 'error' || outcome === 'timeout' || outcome === 'aborted') {
        logger.warn(events.settledEarly, { guildId, outcome })
      }

      return outcome === 'idle'
    } finally {
      attempt.abort()
      voice.connection.off(VoiceConnectionStatus.Destroyed, stopPlayer)
      player.stop(true)

      if (voice.connection.state.status !== VoiceConnectionStatus.Destroyed) {
        voice.connection.subscribe(voice.audioPlayer)
      }
    }
  }

  async function playClip(guildId: string, filePath: string): Promise<boolean> {
    if (disposed || speaking.has(guildId)) {
      return false
    }

    const voice = access.voice(guildId)
    const queue = access.queue(guildId)

    if (voice === null || queue === null || queue.songs.length === 0 || queue.paused) {
      return false
    }

    speaking.add(guildId)

    return track(
      (async (): Promise<boolean> => {
        try {
          return await playThrough(voice, guildId, filePath, SPEECH_TIMEOUT_MS, {
            unreadable: 'music.clip_unreadable',
            settledEarly: 'music.line_failed',
          })
        } catch (error) {
          logger.error('music.line_failed', error, { guildId })

          return false
        } finally {
          // WORKAROUND(https://github.com/discordjs/discord.js/blob/%40discordjs/voice%400.19.2/packages/voice/src/audio/AudioPlayer.ts#L460-L461): pause() is ignored unless the player plays; the queue pauses again once music plays. Goes when autopaused players pause.
          if (
            voice.connection.state.status !== VoiceConnectionStatus.Destroyed &&
            access.queue(guildId)?.paused
          ) {
            const pauseIfStillPaused = (): void => {
              if (access.queue(guildId)?.paused) {
                voice.audioPlayer.pause()
              }
            }

            if (voice.audioPlayer.state.status === AudioPlayerStatus.Playing) {
              pauseIfStillPaused()
            } else {
              voice.audioPlayer.once(AudioPlayerStatus.Playing, pauseIfStillPaused)
            }
          }

          speaking.delete(guildId)
        }
      })(),
    )
  }

  async function playWelcome(channel: VoiceBasedChannel): Promise<void> {
    const guildId = channel.guild.id

    if (disposed || !hasWelcome || greeted.has(guildId)) {
      return
    }

    greeted.add(guildId)

    let voice: VoiceSession

    try {
      voice = await access.join(channel)
    } catch (error) {
      greeted.delete(guildId)
      logger.error('music.welcome_failed', error, { guildId })

      return
    }

    if (disposed) {
      return
    }

    try {
      await playThrough(voice, guildId, welcomeFile, INTRO_TIMEOUT_MS, {
        unreadable: 'music.welcome_unreadable',
        settledEarly: 'music.welcome_settled_early',
      })
    } catch (error) {
      logger.error('music.welcome_failed', error, { guildId })
    }
  }

  async function dispose(): Promise<void> {
    if (disposed) {
      return
    }

    disposed = true
    abort.abort()
    speaking.clear()
    greeted.clear()

    await Promise.allSettled(pending)
  }

  return { playClip, playWelcome, dispose }
}

async function waitForAudio(
  player: AudioPlayerLike,
  connection: VoiceConnectionLike,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<AudioOutcome> {
  return new Promise((resolveOutcome) => {
    let settled = false

    function finish(outcome: AudioOutcome): void {
      if (settled) {
        return
      }

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

    const timer = setTimeout(() => finish('timeout'), timeoutMs)

    player.on(AudioPlayerStatus.Idle, onIdle)
    player.on('error', onError)
    connection.on(VoiceConnectionStatus.Destroyed, onDestroyed)
    signal.addEventListener('abort', onAbort, { once: true })

    if (signal.aborted) {
      onAbort()
    } else if (connection.state.status === VoiceConnectionStatus.Destroyed) {
      onDestroyed()
    }
  })
}
