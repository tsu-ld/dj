import type { Queue } from 'distube'
import type { Logger } from '../../core/logger.ts'
import { errorMessage } from '../../core/errors.ts'

type VoiceOf = Queue['voice']

// The voice re-emits its stream's errors, and removing a queue detaches the
// engine's listener from it; an emitter with no "error" listener throws, so
// ours stays on every voice for good and only names the error.
export function voiceGuard(logger: Logger): (guildId: string, voice: VoiceOf) => void {
  const guarded = new WeakSet<VoiceOf>()

  return (guildId, voice) => {
    if (guarded.has(voice))
      return

    guarded.add(voice)
    voice.on('error', (error: Error) => logger.warn('music.voice_error', { guildId, error: errorMessage(error) }))
  }
}
