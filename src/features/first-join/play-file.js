import { createReadStream } from 'node:fs'
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
} from '@discordjs/voice'

export function playFileInVoice(connection, filePath) {
  return new Promise((resolve, reject) => {
    const resource = createAudioResource(createReadStream(filePath))
    const player = createAudioPlayer()

    player.on(AudioPlayerStatus.Idle, () => {
      player.stop()
      resolve()
    })

    player.on('error', (error) => {
      player.stop()
      reject(error)
    })

    connection.subscribe(player)
    player.play(resource)
  })
}
