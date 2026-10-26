import { updateNowPlaying } from '../music/now-playing.js'
import { defineAction } from './action.js'

export const shuffle = defineAction({
  name: 'shuffle',
  description: 'Shuffle the songs that are waiting in the queue.',
  requiresQueue: true,
  run: async (args, { queue }) => {
    await queue.shuffle()
    await updateNowPlaying(queue, queue.songs[0])

    return { shuffled: queue.songs.length }
  },
})
