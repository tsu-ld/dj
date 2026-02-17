export async function skipSong(player, guildId) {
  const queue = player.getQueue(guildId)
  if (!queue)
    return false

  try {
    if (queue.songs.length > 1 || queue.autoplay)
      await queue.skip()
    else
      queue.stop()
    return true
  }
  catch (e) {
    console.error(`[Music] Skip error: ${e?.message ?? e}`)
    queue.stop()
    return true
  }
}
