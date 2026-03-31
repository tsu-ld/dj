import { player } from '#player'
import { findIntroFile } from './find-intro-file.js'
import { playFileInVoice } from './play-file.js'

const INTRO_FILE_PATH = findIntroFile()

export async function playIntroIfFirstJoin(voiceChannel) {
  if (!INTRO_FILE_PATH)
    return

  const guildId = voiceChannel.guild.id

  if (player.voices.has(guildId))
    return
  console.info('[Voice] First join — playing intro.')

  await player.voices.join(voiceChannel)
  const voice = player.voices.get(guildId)
  await playFileInVoice(voice.connection, INTRO_FILE_PATH)

  voice.connection.subscribe(voice.audioPlayer)
}
