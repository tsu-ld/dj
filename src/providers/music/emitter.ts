import type { MusicEventMap } from '../../ports/music.ts'

type Event = keyof MusicEventMap
type EventListener<K extends Event> = (payload: MusicEventMap[K]) => void

type ListenersByEvent<Events extends Event> = { [E in Events]?: Set<EventListener<E>> }

export interface MusicEmitter {
  readonly on: <K extends Event>(event: K, listener: EventListener<K>) => () => void
  readonly emit: <K extends Event>(event: K, payload: MusicEventMap[K]) => void
}

interface OwnedMusicEmitter {
  readonly emitter: MusicEmitter
  readonly clear: () => void
}

export function createEmitter(): OwnedMusicEmitter {
  const listeners: ListenersByEvent<Event> = {}

  function listenersOf<K extends Event>(event: K): Set<EventListener<K>> {
    const ofEvent: ListenersByEvent<K> = listeners
    const subscribed = ofEvent[event] ?? new Set<EventListener<K>>()

    ofEvent[event] = subscribed

    return subscribed
  }

  return {
    emitter: {
      on(event, listener) {
        const subscribed = listenersOf(event).add(listener)

        return () => {
          subscribed.delete(listener)
        }
      },
      emit(event, payload) {
        for (const listener of listenersOf(event)) {
          listener(payload)
        }
      },
    },
    clear() {
      for (const subscribed of Object.values(listeners)) {
        subscribed.clear()
      }
    },
  }
}
