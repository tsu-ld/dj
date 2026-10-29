import type { MusicPort } from '../../ports/music.ts'
import type { MusicEngineDeps } from './playback.ts'
import { musicPlayback } from './playback.ts'

export type { MusicEngineDeps }

export function musicEngine(deps: MusicEngineDeps): MusicPort {
  return musicPlayback(deps)
}
