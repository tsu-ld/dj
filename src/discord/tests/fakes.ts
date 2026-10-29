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
import { fakeMember } from '../../commands/tests/fakes.ts'

export interface FakeSentMessage {
  readonly edits: ViewMessage[]
  readonly deletions: () => number
  readonly message: Message
}

export function fakeSentMessage(id = '900'): FakeSentMessage {
  const edits: ViewMessage[] = []
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

export interface SentRecord extends FakeSentMessage {
  readonly payload: ViewMessage
}

export interface FakeChannel {
  readonly id: string
  readonly sent: SentRecord[]
  readonly channel: GuildTextBasedChannel
}

export function fakeChannel(id = '2', guildId = '123456789012345678'): FakeChannel {
  const sent: SentRecord[] = []
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

  return { id, sent, channel: channel as unknown as GuildTextBasedChannel }
}

export interface IncomingOptions {
  content?: string
  guildId?: string | null
  channelId?: string
  textBased?: boolean
  bot?: boolean
  authorId?: string
  member?: GuildMember | null
  botId?: string
  users?: Map<string, unknown>
  channels?: Map<string, unknown>
  fetchChannel?: (id: string) => unknown
}

export interface IncomingMessage {
  readonly replies: string[]
  readonly reactions: string[]
  readonly message: Message
}

export function fakeIncomingMessage(options: IncomingOptions = {}): IncomingMessage {
  const replies: string[] = []
  const reactions: string[] = []
  const botId = options.botId ?? '999'
  const channelId = options.channelId ?? '2'
  const guildId = 'guildId' in options ? options.guildId : '123456789012345678'
  const value = {
    content: options.content ?? '',
    guildId,
    channelId,
    author: { bot: options.bot ?? false, id: options.authorId ?? 'user-1' },
    client: { user: { id: botId } },
    channel: { id: channelId, isTextBased: () => options.textBased ?? true },
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
      replies.push(typeof payload === 'string' ? payload : payload.content ?? '')

      return value
    },
    async react(emoji: string) {
      reactions.push(emoji)

      return {}
    },
  }

  return { replies, reactions, message: value as unknown as Message }
}

export interface InteractionOptions {
  customId: string
  guildId?: string | null
  channel?: GuildTextBasedChannel | null
  member?: GuildMember
}

export interface InteractionRecorder {
  readonly replies: (string | InteractionReplyOptions)[]
  readonly followUps: InteractionReplyOptions[]
  readonly editReplies: (string | InteractionEditReplyOptions)[]
  readonly edits: ViewMessage[]
  readonly deferredUpdates: () => number
  readonly interaction: ButtonInteraction
}

export function fakeInteraction(options: InteractionOptions): InteractionRecorder {
  const replies: (string | InteractionReplyOptions)[] = []
  const followUps: InteractionReplyOptions[] = []
  const editReplies: (string | InteractionEditReplyOptions)[] = []
  const edits: ViewMessage[] = []
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

export function optionContent(value: string | InteractionReplyOptions | undefined): string | undefined {
  if (value === undefined)
    return undefined

  return typeof value === 'string' ? value : value.content ?? undefined
}

export function editContent(value: string | InteractionEditReplyOptions | undefined): string | undefined {
  if (value === undefined)
    return undefined

  return typeof value === 'string' ? value : value.content ?? undefined
}

export interface RepliesRecorder extends RepliesPort {
  readonly said: string[]
  readonly announced: string[]
}

export function fakeReplies(): RepliesRecorder {
  const said: string[] = []
  const announced: string[] = []

  return {
    said,
    announced,
    async say(_message, _settings, text) {
      said.push(text)
    },
    async announce(_channel, _settings, text) {
      announced.push(text)
    },
  }
}

export interface SlotRecorder extends MessageSlot {
  readonly reposts: SlotPayload[]
  readonly shown: { readonly view: QueueView, readonly channel: GuildTextBasedChannel }[]
  readonly disposed: () => boolean
}

export function fakeSlot(): SlotRecorder {
  const reposts: SlotPayload[] = []
  const shown: { view: QueueView, channel: GuildTextBasedChannel }[] = []
  let disposed = false

  return {
    reposts,
    shown,
    disposed: () => disposed,
    trackStarted: () => {},
    stateChanged: () => {},
    playlistQueued: () => {},
    queueCleared: () => {},
    async showQueue(view, channel) {
      shown.push({ view, channel })
    },
    repost(payload) {
      reposts.push(payload)
    },
    dispose() {
      disposed = true
    },
  }
}
