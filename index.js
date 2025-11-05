import { ChannelType, PermissionFlagsBits } from 'discord.js'
import { createConfig } from './src/config.js'
import { Discord } from './src/services/Discord.js'
import { Music } from './src/services/Music.js'

const config = createConfig()
const discord = new Discord(config)
const music = new Music()

music.attach(discord.client)
await discord.login()

discord.onMessage(async (message) => {
  const voiceChannel = discord.getUserVoiceChannel(message)
  if (!voiceChannel)
    return message.reply('Primero metete a un canal de voz, che.')
  if (voiceChannel.type === ChannelType.GuildStageVoice)
    return message.reply('Ascendeme a speaker en este canal de Stage o usá un canal de voz común.')
  const me = message.guild?.members?.me ?? message.client.user
  const perms = voiceChannel.permissionsFor(me)
  const canConnect = perms?.has(PermissionFlagsBits.Connect)
  const canSpeak = perms?.has(PermissionFlagsBits.Speak)

  if (!canConnect || !canSpeak)
    return message.reply('Necesito permisos para conectarme y hablar en tu canal de voz.')

  try {
    await music.play(voiceChannel, message.content.trim(), message)
  }
  catch (e) {
    console.error(`play error: ${e?.message ?? e}`)
    message.reply('No se pudo arrancar la reproducción. Probá con otra URL/búsqueda o cambiate de canal de voz.')
  }
})

discord.onBotKicked(({ guildId }) => {
  music.stopByGuildId(guildId)
  console.log('Bot was kicked/disconnected; stopped playback.')
})
