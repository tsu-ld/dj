import type { CommandSpec } from './spec.ts'
import { setChannel, setPersona } from './admin.ts'
import { addSongs, query } from './play.ts'
import { pause, radio, resume, seek, shuffle, skip, toggle } from './playback.ts'
import { clear, queue, remove } from './queue.ts'

export const commands: ReadonlyArray<CommandSpec> = [
  addSongs,
  clear,
  pause,
  query,
  queue,
  radio,
  remove,
  resume,
  seek,
  setChannel,
  setPersona,
  shuffle,
  skip,
  toggle,
]
