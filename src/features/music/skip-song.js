import { player } from '#player'

export async function skipSong(guildId) {
  const queue = player.getQueue(guildId)
  if (!queue)
    return

  if (queue.songs.length > 1 || queue.autoplay)
    await queue.skip()
  else
    queue.stop()
}
