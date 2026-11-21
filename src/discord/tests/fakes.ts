import type {
  ButtonInteraction,
  GuildMember,
  GuildTextBasedChannel,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  Message,
} from 'discord.js'
import type { QueueView } from '../../ports/music.ts'
import type { RepliesPort } from '../../ports/replies.ts'
import type { MessageSlot, SlotPayload } from '../slot.ts'
import type { ViewMessage } from '../views.ts'
import { ComponentType } from 'discord.js'
import { fakeMember } from '../../tests/fixtures.ts'

interface FakeSentMessage {
  readonly edits: Array<ViewMessage>
  readonly deletions: () => number
  readonly message: Message
}

function fakeSentMessage(id: string): FakeSentMessage {
  const edits: Array<ViewMessage> = []
  let deletions = 0
  const state = {
    id,
    deletable: true,
    async edit(payload: ViewMessage) {
      edits.push(payload)

      return state.message
    },
    async delete() {
      deletions++

      return state.message
    },
    message: undefined as unknown as Message,
  }

  state.message = state as unknown as Message

  return { edits, deletions: () => deletions, message: state.message }
}

interface SentRecord extends FakeSentMessage {
  readonly payload: ViewMessage
}

interface FakeChannel {
  readonly sent: Array<SentRecord>
  readonly channel: GuildTextBasedChannel
}

export function fakeChannel(id = '2', guildId = '123456789012345678'): FakeChannel {
  const sent: Array<SentRecord> = []
  const channel = {
    id,
    guild: { id: guildId },
    isTextBased: () => true,
    async send(payload: ViewMessage) {
      const record = fakeSentMessage(`sent-${sent.length + 1}`)

      sent.push({ ...record, payload })

      return record.message
    },
  }

  return { sent, channel: channel as unknown as GuildTextBasedChannel }
}

interface IncomingOptions {
  content?: string
  guildId?: string | null
  channelId?: string
  bot?: boolean
  authorId?: string
  member?: GuildMember | null
  botId?: string
  users?: Map<string, unknown>
  channels?: Map<string, unknown>
  fetchChannel?: (id: string) => object | null
  failReact?: boolean
  failReply?: boolean
}

interface IncomingMessage {
  readonly replies: Array<string>
  readonly reactions: Array<string>
  readonly message: Message
}

export function fakeIncomingMessage(options: IncomingOptions = {}): IncomingMessage {
  const replies: Array<string> = []
  const reactions: Array<string> = []
  const botId = options.botId ?? '999'
  const channelId = options.channelId ?? '2'
  const guildId = 'guildId' in options ? options.guildId : '123456789012345678'
  const value = {
    content: options.content ?? '',
    guildId,
    channelId,
    author: { bot: options.bot ?? false, id: options.authorId ?? 'user-1' },
    client: { user: { id: botId } },
    channel: { id: channelId, sendTyping: async () => {} },
    member: 'member' in options ? options.member : fakeMember(),
    mentions: {
      users: options.users ?? new Map<string, unknown>(),
      channels: options.channels ?? new Map<string, unknown>(),
    },
    guild: {
      members: { me: {}, fetch: async () => fakeMember() },
      channels: {
        fetch: async (id: string) => options.fetchChannel?.(id) ?? null,
      },
    },
    inGuild: () => guildId !== null,
    async reply(payload: string | { content?: string }) {
      if (options.failReply) {
        throw new Error('Missing Permissions')
      }

      replies.push(typeof payload === 'string' ? payload : (payload.content ?? ''))

      return value
    },
    async react(emoji: string) {
      if (options.failReact) {
        throw new Error('Missing Permissions')
      }

      reactions.push(emoji)

      return {}
    },
  }

  return { replies, reactions, message: value as unknown as Message }
}

interface InteractionOptions {
  customId: string
  guildId?: string | null
  channel?: GuildTextBasedChannel | null
  member?: GuildMember
  failEditReply?: boolean
}

interface CardEdit extends ViewMessage {
  readonly content?: string | null
  readonly embeds?: ReadonlyArray<unknown>
}

interface InteractionRecorder {
  readonly replies: Array<string | InteractionReplyOptions>
  readonly followUps: Array<InteractionReplyOptions>
  readonly editReplies: Array<string | InteractionEditReplyOptions>
  readonly edits: Array<CardEdit>
  readonly deferredUpdates: () => number
  readonly interaction: ButtonInteraction
}

export function fakeInteraction(options: InteractionOptions): InteractionRecorder {
  const replies: Array<string | InteractionReplyOptions> = []
  const followUps: Array<InteractionReplyOptions> = []
  const editReplies: Array<string | InteractionEditReplyOptions> = []
  const edits: Array<CardEdit> = []
  const member = options.member ?? fakeMember()
  let deferred = 0
  const message = {
    async edit(payload: ViewMessage) {
      edits.push(payload)

      return message
    },
  }
  const value = {
    customId: options.customId,
    guildId: options.guildId === undefined ? '123456789012345678' : options.guildId,
    channel: options.channel === undefined ? fakeChannel().channel : options.channel,
    member,
    user: { id: 'user-1' },
    message,
    guild: { members: { fetch: async () => member } },
    isButton: () => true,
    async deferUpdate() {
      deferred++
    },
    async reply(payload: string | InteractionReplyOptions) {
      replies.push(payload)
    },
    async followUp(payload: InteractionReplyOptions) {
      followUps.push(payload)
    },
    async editReply(payload: string | InteractionEditReplyOptions) {
      if (options.failEditReply) {
        throw new Error('edit reply failed')
      }

      editReplies.push(payload)
    },
  }

  return {
    replies,
    followUps,
    editReplies,
    edits,
    deferredUpdates: () => deferred,
    interaction: value as unknown as ButtonInteraction,
  }
}

export function contentOf(
  value: string | { readonly content?: string | null } | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return typeof value === 'string' ? value : (value.content ?? undefined)
}

export function textsOf(message: ViewMessage | undefined): Array<string> {
  return (message?.components ?? []).flatMap((container) =>
    container.toJSON().components.flatMap((component) => {
      if (component.type === ComponentType.TextDisplay) {
        return [component.content]
      }

      if (component.type === ComponentType.Section) {
        return component.components.map((child) => child.content)
      }

      return []
    }),
  )
}

export function cardText(message: ViewMessage | undefined): string {
  return textsOf(message).join('\n')
}

interface ButtonInfo {
  readonly customId: string
  readonly label: string
  readonly disabled: boolean
  readonly style: number
  readonly emoji: string | null
}

export function buttonsOf(message: ViewMessage): Array<ButtonInfo> {
  return message.components.flatMap((container) =>
    container.toJSON().components.flatMap((component) => {
      if (component.type !== ComponentType.ActionRow) {
        return []
      }

      return component.components.flatMap((child) => {
        if (child.type !== ComponentType.Button || !('custom_id' in child)) {
          return []
        }

        return [
          {
            customId: child.custom_id,
            label: child.label ?? '',
            disabled: child.disabled ?? false,
            style: child.style,
            emoji: child.emoji?.name ?? null,
          },
        ]
      })
    }),
  )
}

export interface RepliesRecorder extends RepliesPort {
  readonly said: Array<string>
}

export function fakeReplies(): RepliesRecorder {
  const said: Array<string> = []

  return {
    said,
    async say(_message, _settings, text) {
      said.push(text)
    },
  }
}

export interface SlotRecorder extends MessageSlot {
  readonly reposts: Array<SlotPayload>
  readonly shown: Array<{ readonly view: QueueView; readonly channel: GuildTextBasedChannel }>
}

export function fakeSlot(): SlotRecorder {
  const reposts: Array<SlotPayload> = []
  const shown: Array<{ view: QueueView; channel: GuildTextBasedChannel }> = []

  return {
    reposts,
    shown,
    update: () => {},
    queueChanged: () => {},
    playlistQueued: () => {},
    queueCleared: () => {},
    async showQueue(view, channel) {
      shown.push({ view, channel })
    },
    repost(payload) {
      reposts.push(payload)
    },
    dispose: () => {},
  }
}
