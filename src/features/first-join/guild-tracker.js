const joinedGuilds = new Set()

export function hasJoinedBefore(guildId) {
  return joinedGuilds.has(guildId)
}

export function markAsJoined(guildId) {
  joinedGuilds.add(guildId)
}

export function clearGuild(guildId) {
  joinedGuilds.delete(guildId)
}
