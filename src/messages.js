const MESSAGES = {
  ERRORS: {
    JOIN_VOICE_CHANNEL: 'che, metete a un canal de voz primero, dale?',
    STAGE_CHANNEL_PERMISSIONS: 'dale, poneme de speaker en este canal de stage o andate a uno de voz normal',
    BOT_PERMISSIONS: 'maestro, necesito permisos para entrar y hablar en tu canal de voz',
    PLAYBACK_ERROR: 'uh, no pude arrancar la música. @tsu aprendé a programar gil',
  },
  CONFIGURATION: {
    textChannelConfigured: channel => `listo, ahora te escucho en ${channel}`,
  },
  MUSIC: {
    nowPlaying: songName => `se viene este temón: "${songName}"`,
  },
}

export default MESSAGES
