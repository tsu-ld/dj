import { once } from 'node:events'
import { createReadStream, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { AudioPlayerStatus, createAudioPlayer, createAudioResource, VoiceConnectionStatus } from '@discordjs/voice'
import { player } from './player.js'

const INTRO_FILE_PATH = resolve(import.meta.dirname, '../../assets/welcome.mp3')
const INTRO_EXISTS = existsSync(INTRO_FILE_PATH)
const INTRO_TIMEOUT_MS = 30_000
const greetedGuilds = new Set()

// The intro runs on its own AudioPlayer and the connection is handed back when
// it ends. Playing it through DisTube's player makes DisTube read the intro's
// idle state as the requested song finishing: it drops the song from the queue
// and leaves the channel before yt-dlp has even finished downloading it.
export async function playIntroIfFirstJoin(voiceChannel) {
  if (!INTRO_EXISTS || greetedGuilds.has(voiceChannel.guild.id))
    return

  greetedGuilds.add(voiceChannel.guild.id)

  let voice

  try {
    voice = await player.voices.join(voiceChannel)
  }
  catch (error) {
    greetedGuilds.delete(voiceChannel.guild.id)
    console.error('[Voice] Intro failed:', error)

    return
  }

  const introPlayer = createAudioPlayer()
  // A destroyed connection unsubscribes the player, which autopauses it and
  // never reaches idle on its own; stopping it settles the wait below.
  const stopIntro = () => introPlayer.stop(true)

  voice.connection.once(VoiceConnectionStatus.Destroyed, stopIntro)
  voice.connection.subscribe(introPlayer)
  introPlayer.play(createAudioResource(createReadStream(INTRO_FILE_PATH)))

  try {
    await once(introPlayer, AudioPlayerStatus.Idle, { signal: AbortSignal.timeout(INTRO_TIMEOUT_MS) })
  }
  catch (error) {
    console.error('[Voice] Intro failed:', error)
  }
  finally {
    voice.connection.off(VoiceConnectionStatus.Destroyed, stopIntro)
    introPlayer.stop(true)
    voice.connection.subscribe(voice.audioPlayer)
  }
}
