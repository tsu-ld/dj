import type { MusicEventMap } from '../../ports/music.ts'

export interface TrackQueue {
  readonly songs: readonly unknown[]
}

export interface MutableTrackQueue {
  songs: unknown[]
}

export interface QueueState extends TrackQueue {
  readonly paused: boolean
  readonly autoplay: boolean
}

export interface SkippableQueue extends TrackQueue {
  readonly autoplay: boolean
  skip: () => Promise<unknown>
}

export interface StoppableQueue {
  readonly id: string
  stop: () => Promise<void>
}

export interface PlayCapture {
  readonly announce: boolean
  playlist: { name: string, count: number } | null
}

export type MusicEmitter = {
  readonly on: <K extends keyof MusicEventMap>(event: K, listener: (payload: MusicEventMap[K]) => void) => () => void
} & { readonly [K in keyof MusicEventMap]: (payload: MusicEventMap[K]) => void }
