import type { MusicEventMap } from '../../ports/music.ts'
import type { MusicEmitter } from './types.ts'

interface Channel<T> {
  on: (listener: (payload: T) => void) => () => void
  emit: (payload: T) => void
  clear: () => void
}

function channel<T>(): Channel<T> {
  const listeners = new Set<(payload: T) => void>()

  return {
    on(listener) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    emit(payload) {
      for (const listener of listeners) listener(payload)
    },
    clear() {
      listeners.clear()
    },
  }
}

// The SDK's events are translated once, here, into the small event map the app
// consumes. Features never import the SDK.
export function createEmitter(): { emitter: MusicEmitter, clear: () => void } {
  const channels: { readonly [K in keyof MusicEventMap]: Channel<MusicEventMap[K]> } = {
    trackQueued: channel<MusicEventMap['trackQueued']>(),
    playlistQueued: channel<MusicEventMap['playlistQueued']>(),
    trackStarted: channel<MusicEventMap['trackStarted']>(),
    stateChanged: channel<MusicEventMap['stateChanged']>(),
    trackSkipped: channel<MusicEventMap['trackSkipped']>(),
    queueEnded: channel<MusicEventMap['queueEnded']>(),
    queueCleared: channel<MusicEventMap['queueCleared']>(),
    playbackError: channel<MusicEventMap['playbackError']>(),
    disconnected: channel<MusicEventMap['disconnected']>(),
  }

  function on<K extends keyof MusicEventMap>(event: K, listener: (payload: MusicEventMap[K]) => void): () => void {
    return channels[event].on(listener)
  }

  const emitter: MusicEmitter = {
    on,
    trackQueued: payload => channels.trackQueued.emit(payload),
    playlistQueued: payload => channels.playlistQueued.emit(payload),
    trackStarted: payload => channels.trackStarted.emit(payload),
    stateChanged: payload => channels.stateChanged.emit(payload),
    trackSkipped: payload => channels.trackSkipped.emit(payload),
    queueEnded: payload => channels.queueEnded.emit(payload),
    queueCleared: payload => channels.queueCleared.emit(payload),
    playbackError: payload => channels.playbackError.emit(payload),
    disconnected: payload => channels.disconnected.emit(payload),
  }

  return {
    emitter,
    clear() {
      for (const event of Object.values(channels)) event.clear()
    },
  }
}
