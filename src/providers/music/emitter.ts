import type { MusicEventMap } from '../../ports/music.ts'
import type { MusicEmitter } from './types.ts'

function channel<T>(): {
  on: (listener: (payload: T) => void) => () => void
  emit: (payload: T) => void
  clear: () => void
} {
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
  const channels = {
    trackQueued: channel<MusicEventMap['trackQueued']>(),
    playlistQueued: channel<MusicEventMap['playlistQueued']>(),
    trackStarted: channel<MusicEventMap['trackStarted']>(),
    stateChanged: channel<MusicEventMap['stateChanged']>(),
    queueEnded: channel<MusicEventMap['queueEnded']>(),
    queueCleared: channel<MusicEventMap['queueCleared']>(),
    playbackError: channel<MusicEventMap['playbackError']>(),
    disconnected: channel<MusicEventMap['disconnected']>(),
  }

  const subscriptions: {
    readonly [K in keyof MusicEventMap]: (listener: (payload: MusicEventMap[K]) => void) => () => void
  } = {
    trackQueued: listener => channels.trackQueued.on(listener),
    playlistQueued: listener => channels.playlistQueued.on(listener),
    trackStarted: listener => channels.trackStarted.on(listener),
    stateChanged: listener => channels.stateChanged.on(listener),
    queueEnded: listener => channels.queueEnded.on(listener),
    queueCleared: listener => channels.queueCleared.on(listener),
    playbackError: listener => channels.playbackError.on(listener),
    disconnected: listener => channels.disconnected.on(listener),
  }

  function on<K extends keyof MusicEventMap>(event: K, listener: (payload: MusicEventMap[K]) => void): () => void {
    return subscriptions[event](listener)
  }

  const emitter: MusicEmitter = {
    on,
    trackQueued: payload => channels.trackQueued.emit(payload),
    playlistQueued: payload => channels.playlistQueued.emit(payload),
    trackStarted: payload => channels.trackStarted.emit(payload),
    stateChanged: payload => channels.stateChanged.emit(payload),
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
