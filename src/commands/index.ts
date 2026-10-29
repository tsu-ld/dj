import type { CommandSpec } from './spec.ts'
import { setChannel, setPersona } from './admin.ts'
import { addSongs, query } from './play.ts'
import { pause, radio, resume, shuffle, skip, toggle } from './playback.ts'
import { clear, queue, remove } from './queue.ts'

// The only registry: tools, routes and lookups are all derived from this list.
export const commands: readonly CommandSpec[] = [
  addSongs,
  clear,
  pause,
  query,
  queue,
  radio,
  remove,
  resume,
  setChannel,
  setPersona,
  shuffle,
  skip,
  toggle,
]
