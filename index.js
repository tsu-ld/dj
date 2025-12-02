import { ChannelType, PermissionFlagsBits } from 'discord.js'
import MESSAGES from '@/messages.js'
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
    message.reply(MESSAGES.ERRORS.JOIN_VOICE_CHANNEL)
    return null
  }

  if (voiceChannel.type === ChannelType.GuildStageVoice) {
    message.reply(MESSAGES.ERRORS.STAGE_CHANNEL_PERMISSIONS)
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
    message.reply(MESSAGES.ERRORS.BOT_PERMISSIONS)
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
    message.reply(MESSAGES.ERRORS.PLAYBACK_ERROR)
  }
}

function handleBotKicked({ guildId }) {
  music.stopByGuildId(guildId)
  console.warn('bot was kicked/disconnected; stopped playback.')
}
