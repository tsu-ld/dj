import DEFAULTS from '#features/messages/default-messages.js'
import { loadConfig } from '#features/config/load-config.js'

const userConfig = await loadConfig()

export const CONFIG = {
  DISCORD_TOKEN: userConfig.DISCORD_TOKEN,
  TEXT_CHANNEL_ID: userConfig.TEXT_CHANNEL_ID,
  MESSAGES: {
    ERRORS: { ...DEFAULTS.ERRORS, ...userConfig.ERRORS },
    CONFIGURATION: {
      textChannelConfigured: channel =>
        (userConfig.CONFIGURATION?.textChannelConfigured ?? DEFAULTS.CONFIGURATION.textChannelConfigured).replace('{{channel}}', channel),
    },
    MUSIC: {
      nowPlaying: song =>
        (userConfig.MESSAGES?.MUSIC?.nowPlaying ?? DEFAULTS.MUSIC.nowPlaying).replace('{{songName}}', song),
      songAdded: song =>
        (userConfig.MESSAGES?.MUSIC?.songAdded ?? DEFAULTS.MUSIC.songAdded).replace('{{songName}}', song),
      playlistAdded: (playlist, count) =>
        (userConfig.MESSAGES?.MUSIC?.playlistAdded ?? DEFAULTS.MUSIC.playlistAdded).replace('{{playlistName}}', playlist).replace('{{songCount}}', count),
    },
  },
}
