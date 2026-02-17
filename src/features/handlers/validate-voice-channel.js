import { ChannelType } from 'discord.js'
import { CONFIG } from '../config/index.js'
import { getUserVoiceChannel } from '../discord/get-user-voice-channel.js'

export function getAndValidateVoiceChannel(message) {
  const voiceChannel = getUserVoiceChannel(message)

  if (!voiceChannel) {
    message.reply(CONFIG.MESSAGES.ERRORS.JOIN_VOICE_CHANNEL)

    return null
  }

  if (voiceChannel.type === ChannelType.GuildStageVoice) {
    message.reply(CONFIG.MESSAGES.ERRORS.STAGE_CHANNEL_PERMISSIONS)

    return null
  }

  return voiceChannel
}
