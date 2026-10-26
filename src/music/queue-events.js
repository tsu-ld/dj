import { Events } from 'distube'
import { announce } from '../dj/speak.js'
import { MESSAGES } from '../messages/en.js'
import { clearPlaybackMessages, showQueue, songDisplayName, updateNowPlaying } from './now-playing.js'
import { player } from './player.js'

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

export function setupMusicEvents(store) {
  player
    .on(Events.ADD_SONG, (queue, song) => {
      const name = songDisplayName(song)
      console.info(`[Music] Song added to queue: ${name}`)

      if (!suppressionDepthByGuild.has(queue.id))
        announceInCharacter(store, queue.textChannel, queue.id, MESSAGES.songAdded(name))
    })
    .on(Events.ADD_LIST, (queue, playlist) => {
      const name = playlist.name ?? playlist.url ?? 'Playlist'
      console.info(`[Music] Playlist added to queue: ${name} (${playlist.songs.length} songs)`)

      if (!suppressionDepthByGuild.has(queue.id))
        announceInCharacter(store, queue.textChannel, queue.id, MESSAGES.playlistAdded(name, playlist.songs.length))

      void showQueue(queue.textChannel, queue).catch((error) => {
        console.error('[Music] Failed to show queue after playlist:', error)
      })
    })
    .on(Events.PLAY_SONG, (queue, song) => {
      console.info(`[Music] Now playing: ${songDisplayName(song)}`)
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
