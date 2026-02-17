import { CONFIG } from '../config/index.js'
import { findIntroFile } from '../first-join/find-intro-file.js'
import { playIntroIfFirstJoin } from '../first-join/play-intro.js'
import { cleanUrl } from '../music/clean-url.js'
import { playSong } from '../music/play-song.js'

const INTRO_FILE_PATH = findIntroFile()

export async function playMusic(player, voiceChannel, message) {
  try {
    if (INTRO_FILE_PATH) {
      try {
        await playIntroIfFirstJoin(player, voiceChannel, INTRO_FILE_PATH)
      }
      catch (e) {
        console.error(`[Voice] Intro error: ${e?.message ?? e}`)
      }
    }

    await playSong(player, voiceChannel, cleanUrl(message.content.trim()), message)
  }
  catch (e) {
    if (e.errorCode === 'NO_RESULT') {
      message.reply(CONFIG.MESSAGES.ERRORS.NO_RESULT)
      return
    }
    console.error(`[Music] Play error: ${e?.message ?? e}`)
    message.reply(CONFIG.MESSAGES.ERRORS.PLAYBACK_ERROR)
  }
}
