import type { Logger } from '../core/logger.ts'
import type { SpeechPort } from '../ports/speech.ts'
import { rm } from 'node:fs/promises'
import { errorMessage } from '../core/errors.ts'

// Deletes a clip the host owns. A failed delete is logged, never thrown: the
// provider keeps the path so dispose can retry it.
export function clipRemover(speech: SpeechPort, logger: Logger): (file: string | null) => Promise<void> {
  return async (file) => {
    if (file === null)
      return

    try {
      await rm(file, { force: true })
      speech.release(file)
    }
    catch (error) {
      logger.warn('on-air.clip_delete_failed', { file, error: errorMessage(error) })
    }
  }
}
