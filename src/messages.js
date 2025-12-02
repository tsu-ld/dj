const MESSAGES = {
  errors: {
    joinVoiceChannel: 'primero metete a un canal de voz, che.',
    stageChannelPermissions: 'ascendeme a speaker en este canal de stage o usá un canal de voz común',
    botPermissions: 'maestro, necesito permisos para conectarme y hablar en tu canal de voz',
    playbackError: 'no se pudo arrancar la reproducción. Probá con otra URL/búsqueda o cambiate de canal de voz',
  },
  configuration: {
    textChannelConfigured: channel => `Listo, ahora te escucho en ${channel}.`,
  },
  music: {
    nowPlaying: songName => `arranca este temón: "${songName}"`,
  },
}

export default MESSAGES
