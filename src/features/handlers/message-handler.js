import { CONFIG } from '#features/config/app-config.js'
import { ChannelType } from 'discord.js'
import { getUserVoiceChannel } from '#features/discord/get-user-voice-channel.js'
import { hasVoicePermissions } from '#features/discord/has-voice-permissions.js'
import { skipSong } from '#features/music/skip-song.js'
import { isSkipCommand } from '#features/skip/is-skip-command.js'
import { playMusic } from '#features/handlers/play-music.js'

export async function handleMessage(message) {
  const voiceChannel = getUserVoiceChannel(message)

  if (!voiceChannel) {
    message.reply(CONFIG.MESSAGES.ERRORS.JOIN_VOICE_CHANNEL)

    return
  }

  if (voiceChannel.type === ChannelType.GuildStageVoice) {
    message.reply(CONFIG.MESSAGES.ERRORS.STAGE_CHANNEL_PERMISSIONS)

    return
  }

  if (!hasVoicePermissions(voiceChannel, message)) {
    message.reply(CONFIG.MESSAGES.ERRORS.BOT_PERMISSIONS)

    return
  }

  if (isSkipCommand(message)) {
    await skipSong(message.guildId)
    message.react('✅')

    return
  }

  await playMusic(voiceChannel, message)
}
