import { createConfig } from './config.js'

const config = createConfig()
const USER_CONFIG = config.messages || {}

const MESSAGES = {
  ERRORS: {
    JOIN_VOICE_CHANNEL: USER_CONFIG.ERRORS?.JOIN_VOICE_CHANNEL ?? 'Please join a voice channel first to use this command.',
    STAGE_CHANNEL_PERMISSIONS: USER_CONFIG.ERRORS?.STAGE_CHANNEL_PERMISSIONS ?? 'I need speaker permissions to play in a stage channel, or we can use a regular voice channel.',
    BOT_PERMISSIONS: USER_CONFIG.ERRORS?.BOT_PERMISSIONS ?? 'I need permissions to join and speak in your voice channel.',
    PLAYBACK_ERROR: USER_CONFIG.ERRORS?.PLAYBACK_ERROR ?? 'Sorry, I encountered an error while trying to play music.',
  },
  CONFIGURATION: {
    textChannelConfigured: (channel) => {
      const template = USER_CONFIG.CONFIGURATION?.textChannelConfigured ?? 'All set! I am now listening in {{channel}}.'
      return template.replace('{{channel}}', channel)
    },
  },
  MUSIC: {
    nowPlaying: (songName) => {
      const template = USER_CONFIG.MUSIC?.nowPlaying ?? 'Now playing: "{{songName}}"'
      return template.replace('{{songName}}', songName)
    },
  },
}

export default MESSAGES
