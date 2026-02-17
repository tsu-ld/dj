const DEFAULTS = {
  ERRORS: {
    JOIN_VOICE_CHANNEL: 'Please join a voice channel first to use this command.',
    STAGE_CHANNEL_PERMISSIONS: 'I need speaker permissions to play in a stage channel, or we can use a regular voice channel.',
    BOT_PERMISSIONS: 'I need permissions to join and speak in your voice channel.',
    NO_RESULT: 'Sorry, I couldn\'t find any song matching your query.',
    PLAYBACK_ERROR: 'Sorry, I encountered an error while trying to play music.',
  },
  CONFIGURATION: {
    textChannelConfigured: 'All set! I am now listening in {{channel}}.',
  },
  MUSIC: {
    nowPlaying: 'Now playing: "{{songName}}"',
  },
}

export default DEFAULTS
