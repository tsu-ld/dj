import { player } from '#player'

export function stopByGuildId(guildId) {
  const queue = player.getQueue(guildId)
  if (queue)
    queue.stop()
}
