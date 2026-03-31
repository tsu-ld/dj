import { player } from '#player'
import { CONFIG } from '#features/config/index.js'
import { playIntroIfFirstJoin } from '../first-join/play-intro.js'
import { cleanUrl } from '../music/clean-url.js'
import { playSong } from '../music/play-song.js'

export async function playMusic(voiceChannel, message) {
  try {
    await playIntroIfFirstJoin(voiceChannel)
    await playSong(voiceChannel, cleanUrl(message.content.trim()), message)
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
