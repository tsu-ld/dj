import { skipSong } from '../music/queue-controls.js'
import { defineAction } from './action.js'

export const skip = defineAction({
  name: 'skip',
  description: 'Skip the song that is playing now.',
  requiresQueue: true,
  run: async (args, { queue }) => {
    const skipped = queue.songs[0]?.name ?? null

    await skipSong(queue)

    return { skipped }
  },
})
