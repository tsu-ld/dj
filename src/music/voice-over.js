import { once } from 'node:events'
import { createReadStream } from 'node:fs'
import { AudioPlayerStatus, createAudioPlayer, createAudioResource, VoiceConnectionStatus } from '@discordjs/voice'
import { player } from './player.js'

const SPEECH_TIMEOUT_MS = 30_000

const speaking = new Set()

// A voice connection plays one stream at a time, so the line takes the
// connection while the music holds its position: DisTube's player pauses
// itself when it loses the subscriber and resumes when it gets it back.
// Queue state is never touched, so the now-playing card keeps saying "Playing".
export async function playOverMusic(guildId, filePath, { player: music = player, createPlayer = createAudioPlayer } = {}) {
  if (speaking.has(guildId))
    return false

  const voice = music.voices.get(guildId)
  const queue = music.getQueue(guildId)

  if (!voice?.connection || !queue?.songs?.length || queue.paused)
    return false

  speaking.add(guildId)

  const speechPlayer = createPlayer()
  const stopSpeech = () => speechPlayer.stop(true)

  voice.connection.once(VoiceConnectionStatus.Destroyed, stopSpeech)

  try {
    voice.connection.subscribe(speechPlayer)
    speechPlayer.play(createAudioResource(createReadStream(filePath)))
    await once(speechPlayer, AudioPlayerStatus.Idle, { signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS) })

    return true
  }
  catch (error) {
    console.error('[Voice] Could not speak over the music:', error)

    return false
  }
  finally {
    voice.connection.off(VoiceConnectionStatus.Destroyed, stopSpeech)
    speechPlayer.stop(true)

    if (voice.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      voice.connection.subscribe(voice.audioPlayer)

      // A pause pressed while the line held the connection never reached
      // DisTube's player; apply it once the music is playing again.
      if (music.getQueue(guildId)?.paused) {
        const pauseIfStillPaused = () => {
          if (music.getQueue(guildId)?.paused)
            voice.audioPlayer.pause()
        }

        if (voice.audioPlayer.state.status === AudioPlayerStatus.Playing)
          pauseIfStillPaused()
        else
          voice.audioPlayer.once(AudioPlayerStatus.Playing, pauseIfStillPaused)
      }
    }

    speaking.delete(guildId)
  }
}
