import type { Queue } from 'distube'
import type { Logger } from '../../core/logger.ts'
import { errorMessage } from '../../core/errors.ts'

type VoiceOf = Queue['voice']

// The SDK's voice re-emits stream errors but loses its listener when the queue
// is removed; an emitter with no "error" listener throws.
export function voiceGuard(logger: Logger): (guildId: string, voice: VoiceOf) => void {
  const guarded = new WeakSet<VoiceOf>()

  return (guildId, voice) => {
    if (guarded.has(voice))
      return

    guarded.add(voice)
    voice.on('error', (error: Error) => logger.warn('music.voice_error', { guildId, error: errorMessage(error) }))
  }
}
