import { updateNowPlaying } from '../music/now-playing.js'
import { defineAction } from './action.js'

export const radio = defineAction({
  name: 'radio',
  description: 'Turn the radio on or off: when it is on, related songs keep playing after the queue runs dry.',
  requiresQueue: true,
  run: async (args, { queue }) => {
    queue.toggleAutoplay()
    await updateNowPlaying(queue, queue.songs[0])

    return { radio: queue.autoplay }
  },
})
