import type { AudioPlayerLike, VoiceConnectionLike } from './audio-types.ts'
import { AudioPlayerStatus, VoiceConnectionStatus } from '@discordjs/voice'

type AudioOutcome = 'idle' | 'error' | 'destroyed' | 'timeout' | 'aborted'

export async function waitForAudio(
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
