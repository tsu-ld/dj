import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { playFileInVoice } from '#features/first-join/play-file.js'
import { player } from '#player'

const INTRO_FILE_PATH = resolve('assets', 'welcome.mp3')
const INTRO_EXISTS = existsSync(INTRO_FILE_PATH)

export async function playIntroIfFirstJoin(voiceChannel) {
  if (!INTRO_EXISTS)
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
