const MESSAGES = {
  errors: {
    joinVoiceChannel: 'che, metete a un canal de voz primero, dale?',
    stageChannelPermissions: 'dale, poneme de speaker en este canal de stage o andate a uno de voz normal',
    botPermissions: 'maestro, necesito permisos para entrar y hablar en tu canal de voz',
    playbackError: 'uh, no pude arrancar la música. @tsu aprendé a programar gil',
  },
  configuration: {
    textChannelConfigured: channel => `listo, ahora te escucho en ${channel}`,
  },
  music: {
    nowPlaying: songName => `se viene este temón: "${songName}"`,
  },
}

export default MESSAGES
