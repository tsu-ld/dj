import { Events } from 'distube'
import { endRadioSession, prepareNextLine, speakOnAir } from '../dj/radio.js'
import { announce } from '../dj/speak.js'
import { MESSAGES } from '../messages.js'
import { clearPlaybackMessages, showQueue, songDisplayName, updateNowPlaying } from './now-playing.js'
import { player } from './player.js'
import { prefetchAudio, setBeforeStream } from './yt-dlp-plugin.js'

function announceInCharacter(store, textChannel, guildId, text) {
  if (!textChannel)
    return

  announce(textChannel, store.get(guildId), text)
}

// The dj's own tool calls add songs too; announcing each one would flood the
// channel and spend a request per song on messages the dj is already phrasing.
const suppressionDepthByGuild = new Map()

// A broken playlist fails one song at a time; announcing every failure would
// flood the channel and spend one llm request per song.
const ERROR_ANNOUNCE_INTERVAL_MS = 30_000
const lastErrorAnnouncementByGuild = new Map()

function shouldAnnounceError(guildId) {
  const now = Date.now()
  const lastAnnouncement = lastErrorAnnouncementByGuild.get(guildId) ?? 0

  if (now - lastAnnouncement < ERROR_ANNOUNCE_INTERVAL_MS)
    return false

  lastErrorAnnouncementByGuild.set(guildId, now)

  return true
}

// Distube shifts the failed song before emitting ERROR and then stops the queue
// without FINISH, which leaves the voice connection open. Compare against the
// live queue so a replacement queue does not get its card deleted.
export function shouldCleanupAfterError(queue, liveQueue) {
  return queue.songs.length === 0 && liveQueue === queue
}

function cleanupAfterError(queue) {
  console.info('[Music] Playback error left the queue empty, leaving voice')
  void clearPlaybackMessages(queue.id)
  player.voices.get(queue.id)?.leave()
}

export async function withAnnouncementsSuppressed(guildId, run) {
  suppressionDepthByGuild.set(guildId, (suppressionDepthByGuild.get(guildId) ?? 0) + 1)

  try {
    await run()
  }
  finally {
    const depth = suppressionDepthByGuild.get(guildId) - 1

    if (depth > 0)
      suppressionDepthByGuild.set(guildId, depth)
    else
      suppressionDepthByGuild.delete(guildId)
  }
}

function queueForSong(song) {
  const guildId = song.member?.guild?.id

  if (guildId)
    return player.getQueue(guildId)

  for (const queue of player.queues.collection.values()) {
    if (queue.songs[0] === song)
      return queue
  }

  return null
}

// A Spotify song resolves its YouTube stream first; the line belongs to the
// song the queue is showing, not to the internal search result.
export function songToAnnounce(song, queue) {
  const current = queue?.songs?.[0]

  if (!current)
    return null

  if (current !== song && current.stream?.playFromSource !== false)
    return null

  return current
}

export function setupMusicEvents(store) {
  // The stream waits for this hook, so the line plays in the gap and never over
  // the song.
  setBeforeStream(async (song) => {
    const queue = queueForSong(song)
    const current = songToAnnounce(song, queue)

    if (!current)
      return

    try {
      await speakOnAir(store, queue, current)
    }
    catch (error) {
      console.error('[Voice] Could not speak on air:', error)
    }
  })

  player
    .on(Events.ADD_SONG, (queue, song) => {
      const name = songDisplayName(song)
      console.info(`[Music] Song added to queue: ${name}`)

      if (!suppressionDepthByGuild.has(queue.id))
        announceInCharacter(store, queue.textChannel, queue.id, MESSAGES.songAdded(name))

      if (queue.songs[1] === song)
        void prepareNextLine(store, queue).catch(error => console.error('[Voice] Could not prepare the next line:', error))
    })
    .on(Events.ADD_LIST, (queue, playlist) => {
      const name = playlist.name ?? playlist.url ?? 'Playlist'
      console.info(`[Music] Playlist added to queue: ${name} (${playlist.songs.length} songs)`)

      if (!suppressionDepthByGuild.has(queue.id))
        announceInCharacter(store, queue.textChannel, queue.id, MESSAGES.playlistAdded(name, playlist.songs.length))

      void prepareNextLine(store, queue).catch(error => console.error('[Voice] Could not prepare the next line:', error))

      void showQueue(queue.textChannel, queue).catch((error) => {
        console.error('[Music] Failed to show queue after playlist:', error)
      })
    })
    .on(Events.PLAY_SONG, (queue, song) => {
      console.info(`[Music] Now playing: ${songDisplayName(song)}`)
      prefetchAudio(queue.songs[1], queue.id)
      void updateNowPlaying(queue, song).catch(error => console.error('[Music] Failed to update now playing:', error))
    })
    .on(Events.FINISH, (queue) => {
      console.info('[Music] Queue finished, leaving voice')
      void clearPlaybackMessages(queue.id)
      player.voices.get(queue.id)?.leave()
    })
    .on(Events.NO_RELATED, (queue) => {
      console.info('[Music] Radio found no related song, leaving voice')
      void clearPlaybackMessages(queue.id)
      player.voices.get(queue.id)?.leave()
    })
    // A disconnect ends the session: the prepared audio is dropped and the next
    // request starts a fresh count for the song on air, while the cadence runs on.
    .on(Events.DISCONNECT, (queue) => {
      endRadioSession(queue.id)
    })
    .on(Events.ERROR, (error, queue) => {
      console.error('[Music] DisTube error:', error)

      if (!queue)
        return

      if (shouldCleanupAfterError(queue, player.getQueue(queue.id)))
        cleanupAfterError(queue)

      if (shouldAnnounceError(queue.id))
        announceInCharacter(store, queue.textChannel, queue.id, MESSAGES.playbackError)
    })
}
