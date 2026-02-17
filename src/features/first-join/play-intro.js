import { playFileInVoice } from './play-file.js'

export async function playIntroIfFirstJoin(player, voiceChannel, filePath) {
  const guildId = voiceChannel.guild.id

  if (player.voices.has(guildId))
    return

  console.info('[Voice] First join — playing intro.')

  await player.voices.join(voiceChannel)
  const voice = player.voices.get(guildId)
  await playFileInVoice(voice.connection, filePath)

  voice.connection.subscribe(voice.audioPlayer)
}
