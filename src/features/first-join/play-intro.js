import { hasJoinedBefore, markAsJoined } from './guild-tracker.js'
import { introFilePath } from './intro-path.js'
import { playFileInVoice } from './play-file.js'

export async function playIntroIfFirstJoin(distube, voiceChannel, filename) {
  const guildId = voiceChannel.guild.id

  if (hasJoinedBefore(guildId))
    return

  markAsJoined(guildId)

  const filePath = introFilePath(filename)
  console.warn(`first join — playing intro: ${filePath}`)

  await distube.voices.join(voiceChannel)
  const voice = distube.voices.get(guildId)
  await playFileInVoice(voice.connection, filePath)
}
