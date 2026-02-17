import { playFileInVoice } from './play-file.js'

export async function playIntroIfFirstJoin(player, voiceChannel, filePath) {
  const guildId = voiceChannel.guild.id

  if (player.voices.has(guildId))
    return

  console.warn(`first join — playing intro: ${filePath}`)

  await player.voices.join(voiceChannel)
  const voice = player.voices.get(guildId)
  await playFileInVoice(voice.connection, filePath)

  voice.connection.subscribe(voice.audioPlayer)
}
