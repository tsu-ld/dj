import type { Message } from 'discord.js'
import type { QueueView } from '../../ports/music.ts'
import type { ContextOptions } from '../../tests/fixtures.ts'
import type { QueueContext, VoiceContext } from '../spec.ts'
import { fakeContext, fakeVoice, testView } from '../../tests/fixtures.ts'

export function queueContext(options: ContextOptions & { queue?: QueueView } = {}): QueueContext {
  return { ...fakeContext(options), queue: options.queue ?? testView() }
}

export function voiceContext(options: ContextOptions = {}): VoiceContext {
  return { ...fakeContext(options), voiceChannel: options.voiceChannel ?? fakeVoice() }
}

export interface MessageOptions {
  content?: string
  channels?: ReadonlyArray<{ readonly id: string; readonly name?: string }>
  fetchChannel?: (id: string) => object | null
}

export function fakeMessage(options: MessageOptions = {}): Message {
  const channels = options.channels ?? []
  const value = {
    content: options.content ?? '',
    mentions: {
      channels: new Map(channels.map((channel) => [channel.id, channel])),
      users: new Map(),
    },
    guild: {
      members: { me: {} },
      channels: {
        async fetch(id: string) {
          if (options.fetchChannel) {
            return options.fetchChannel(id)
          }

          return channels.find((channel) => channel.id === id) ?? null
        },
      },
    },
  }

  return value as unknown as Message
}
