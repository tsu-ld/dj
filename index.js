import { ChannelType, PermissionFlagsBits } from 'discord.js'
import { createConfig } from './src/config.js'
import { Discord } from './src/services/Discord.js'
import { Music } from './src/services/Music.js'

const config = createConfig()
const discord = new Discord(config)
const music = new Music()

main().catch(console.error)

async function main() {
  music.attach(discord.client)
  setupEventHandlers()
  await discord.login()
}

function setupEventHandlers() {
  discord.onMessage(handleMessage)
  discord.onBotKicked(handleBotKicked)
}

async function handleMessage(message) {
  const voiceChannel = await getAndValidateVoiceChannel(message)
  if (!voiceChannel)
    return

  if (!hasPermissions(voiceChannel, message))
    return

  await playMusic(voiceChannel, message)
}

function getAndValidateVoiceChannel(message) {
  const voiceChannel = discord.getUserVoiceChannel(message)
  if (!voiceChannel) {
    message.reply('primero metete a un canal de voz, che.')
    return null
  }

  if (voiceChannel.type === ChannelType.GuildStageVoice) {
    message.reply('ascendeme a speaker en este canal de stage o usá un canal de voz común')
    return null
  }

  return voiceChannel
}

function hasPermissions(voiceChannel, message) {
  const me = message.guild?.members?.me ?? message.client.user
  const perms = voiceChannel.permissionsFor(me)
  const canConnect = perms?.has(PermissionFlagsBits.Connect)
  const canSpeak = perms?.has(PermissionFlagsBits.Speak)

  if (!canConnect || !canSpeak) {
    message.reply('maestro, necesito permisos para conectarme y hablar en tu canal de voz')
    return false
  }
  return true
}

async function playMusic(voiceChannel, message) {
  try {
    await music.play(voiceChannel, message.content.trim(), message)
  }
  catch (e) {
    console.error(`play error: ${e?.message ?? e}`)
    message.reply('no se pudo arrancar la reproducción. Probá con otra URL/búsqueda o cambiate de canal de voz')
  }
}

function handleBotKicked({ guildId }) {
  music.stopByGuildId(guildId)
  console.warn('bot was kicked/disconnected; stopped playback.')
}
