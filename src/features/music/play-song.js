import { player } from '#player'

export async function playSong(voiceChannel, query, message) {
  return player.play(voiceChannel, query, {
    textChannel: message.channel,
    member: message.member,
  })
}
