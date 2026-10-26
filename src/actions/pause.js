import { updateNowPlaying } from '../music/now-playing.js'
import { defineAction } from './action.js'

export const pause = defineAction({
  name: 'pause',
  description: 'Pause the music that is playing.',
  requiresQueue: true,
  run: async (args, { queue }) => {
    if (!queue.paused)
      await queue.pause()

    await updateNowPlaying(queue, queue.songs[0])

    return { paused: queue.paused }
  },
})
