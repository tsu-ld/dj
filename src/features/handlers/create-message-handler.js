import { CONFIG } from '../config/index.js'
import { hasVoicePermissions } from '../discord/has-voice-permissions.js'
import { skipSong } from '../music/skip-song.js'
import { isSkipCommand } from '../skip/is-skip-command.js'
import { playMusic } from './play-music.js'
import { getAndValidateVoiceChannel } from './validate-voice-channel.js'

export function createMessageHandler(player) {
  return async function handleMessage(message) {
    const voiceChannel = getAndValidateVoiceChannel(message)
    if (!voiceChannel)
      return

    if (!hasVoicePermissions(voiceChannel, message)) {
      message.reply(CONFIG.MESSAGES.ERRORS.BOT_PERMISSIONS)

      return
    }

    if (isSkipCommand(message)) {
      const skipped = await skipSong(player, message.guildId)
      if (skipped)
        message.react('✅')

      return
    }

    await playMusic(player, voiceChannel, message)
  }
}
