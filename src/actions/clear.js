import { resetRadioSession } from '../dj/radio.js'
import { clearQueue } from '../music/queue-controls.js'
import { defineAction } from './action.js'

export const clear = defineAction({
  name: 'clear',
  description: 'Stop the music, clear the queue and leave the voice channel.',
  requiresQueue: true,
  run: async (args, { queue }) => {
    await clearQueue(queue)
    // Queue#stop() removes the queue and its voice listeners, so no DISCONNECT
    // fires here: a clear is a hard stop, the next request starts a new station.
    resetRadioSession(queue.id)

    return { cleared: true }
  },
})
