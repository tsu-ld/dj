import { updateNowPlaying } from '../music/now-playing.js'
import { defineAction } from './action.js'

// Button-only: a blind toggle is fine for the now-playing row, but the model
// must name the outcome.
export const toggle = defineAction({
  name: 'toggle',
  description: 'Pause or resume whatever is playing.',
  tool: false,
  route: false,
  ack: false,
  requiresQueue: true,
  run: async (args, { queue }) => {
    await (queue.paused ? queue.resume() : queue.pause())
    await updateNowPlaying(queue, queue.songs[0])

    return { paused: queue.paused }
  },
})
