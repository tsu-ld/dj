import DEFAULTS from '../messages/default-messages.js'
import { loadConfig } from './load-config.js'

const USER_CONFIG = await loadConfig()

export const CONFIG = {
  DISCORD_TOKEN: USER_CONFIG.DISCORD_TOKEN,
  TEXT_CHANNEL_ID: USER_CONFIG.TEXT_CHANNEL_ID,
  MESSAGES: {
    ERRORS: {
      JOIN_VOICE_CHANNEL: USER_CONFIG.ERRORS?.JOIN_VOICE_CHANNEL ?? DEFAULTS.ERRORS.JOIN_VOICE_CHANNEL,
      STAGE_CHANNEL_PERMISSIONS: USER_CONFIG.ERRORS?.STAGE_CHANNEL_PERMISSIONS ?? DEFAULTS.ERRORS.STAGE_CHANNEL_PERMISSIONS,
      BOT_PERMISSIONS: USER_CONFIG.ERRORS?.BOT_PERMISSIONS ?? DEFAULTS.ERRORS.BOT_PERMISSIONS,
      NO_RESULT: USER_CONFIG.ERRORS?.NO_RESULT ?? DEFAULTS.ERRORS.NO_RESULT,
      PLAYBACK_ERROR: USER_CONFIG.ERRORS?.PLAYBACK_ERROR ?? DEFAULTS.ERRORS.PLAYBACK_ERROR,
    },
    CONFIGURATION: {
      textChannelConfigured: (channel) => {
        const template = USER_CONFIG.CONFIGURATION?.textChannelConfigured ?? DEFAULTS.CONFIGURATION.textChannelConfigured

        return template.replace('{{channel}}', channel)
      },
    },
    MUSIC: {
      nowPlaying: (songName) => {
        const template = USER_CONFIG.MUSIC?.nowPlaying ?? DEFAULTS.MUSIC.nowPlaying

        return template.replace('{{songName}}', songName)
      },
    },
  },
}
