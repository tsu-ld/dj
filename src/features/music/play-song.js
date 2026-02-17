export async function playSong(player, voiceChannel, query, message) {
  return player.play(voiceChannel, query, {
    textChannel: message.channel,
    member: message.member,
  })
}
