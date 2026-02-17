export function stopByGuildId(player, guildId) {
  const queue = player.getQueue(guildId)
  if (queue)
    queue.stop()
}
