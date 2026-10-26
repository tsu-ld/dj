import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js'
import { player } from './player.js'

const QUEUE_PAGE_SIZE = 10
const NOW_PLAYING_REPOST_DEBOUNCE_MS = 2_000
const nowPlayingMessages = new Map()
const repostTimersByGuild = new Map()
const messageWritesByGuild = new Map()
const queueMessages = new Map()

export function songDisplayName(song) {
  return song.name ?? song.url ?? 'Unknown song'
}

export function updateNowPlaying(queue, song) {
  return withQueuedWrites(queue.id, () => writeNowPlaying(queue, song))
}

function withQueuedWrites(guildId, write) {
  const previous = messageWritesByGuild.get(guildId) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(write)
  messageWritesByGuild.set(guildId, next)

  void next.catch(() => {}).then(() => {
    if (messageWritesByGuild.get(guildId) === next)
      messageWritesByGuild.delete(guildId)
  })

  return next
}

export function clearPlaybackMessages(guildId) {
  clearTimeout(repostTimersByGuild.get(guildId))
  repostTimersByGuild.delete(guildId)

  return withQueuedWrites(guildId, async () => {
    await deleteTrackedMessage(nowPlayingMessages, guildId, 'now playing message')
    await deleteTrackedMessage(queueMessages, guildId, 'queue message')
  })
}

async function deleteTrackedMessage(messagesByGuild, guildId, label) {
  const message = messagesByGuild.get(guildId)
  messagesByGuild.delete(guildId)

  if (!message?.deletable)
    return

  await message.delete().catch((error) => {
    console.error(`[Music] Failed to delete ${label}:`, error)
  })
}

async function writeNowPlaying(queue, song) {
  if (!song || queue.songs.length === 0)
    return

  const channel = queue.textChannel

  if (!channel)
    return

  const embed = nowPlayingEmbed(queue, song)
  const rows = nowPlayingRows(queue)
  const existing = nowPlayingMessages.get(queue.id)

  if (existing?.editable && existing.channelId === channel.id) {
    try {
      await existing.edit({ embeds: [embed], components: rows })

      return
    }
    catch (error) {
      console.error('[Music] Failed to edit now playing message:', error)

      if (nowPlayingMessages.get(queue.id) === existing)
        nowPlayingMessages.delete(queue.id)
    }
  }

  const sent = await channel.send({ embeds: [embed], components: rows })
  nowPlayingMessages.set(queue.id, sent)
}

export function scheduleNowPlayingRepost(queue) {
  const guildId = queue.id

  clearTimeout(repostTimersByGuild.get(guildId))

  repostTimersByGuild.set(guildId, setTimeout(() => {
    repostTimersByGuild.delete(guildId)
    void withQueuedWrites(guildId, () => repostNowPlaying(guildId)).catch((error) => {
      console.error('[Music] Failed to repost now playing message:', error)
    })
  }, NOW_PLAYING_REPOST_DEBOUNCE_MS))
}

// resolve the live queue by guild id: the timer's queue may be gone by the time it fires,
// and writing through the dead queue would clobber the replacement queue's card
async function repostNowPlaying(guildId) {
  const queue = player.getQueue(guildId)

  if (!queue || !nowPlayingMessages.has(guildId))
    return

  await deleteTrackedMessage(nowPlayingMessages, guildId, 'old now playing message')
  await writeNowPlaying(queue, queue.songs[0])
}

export function nowPlayingEmbed(queue, song) {
  return new EmbedBuilder()
    .setTitle(songDisplayName(song))
    .setURL(song.url ?? null)
    .setThumbnail(song.thumbnail ?? null)
    .addFields(
      { name: 'Duration', value: song.formattedDuration || (song.isLive ? 'Live' : 'Unknown'), inline: true },
      { name: 'Requested by', value: song.member?.displayName ?? 'Unknown', inline: true },
      { name: 'Status', value: queue.paused ? 'Paused' : 'Playing', inline: true },
    )
    .setFooter({ text: `${Math.max(queue.songs.length - 1, 0)} in queue` })
}

export function nowPlayingRows(queue) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('np:toggle').setLabel(queue.paused ? 'Resume' : 'Pause').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('np:skip').setLabel('Skip').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('np:radio').setLabel('Radio').setStyle(queue.autoplay ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('np:shuffle').setLabel('Shuffle').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('np:clear').setLabel('Clear').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('np:queue').setLabel('Queue').setStyle(ButtonStyle.Secondary),
    ),
  ]
}

export function queueView(queue, requestedPage) {
  const total = queue.songs.length
  const pageCount = Math.max(Math.ceil(total / QUEUE_PAGE_SIZE), 1)
  const page = Math.min(Math.max(requestedPage, 1), pageCount)
  const start = (page - 1) * QUEUE_PAGE_SIZE
  const lines = queue.songs
    .slice(start, start + QUEUE_PAGE_SIZE)
    .map((song, index) => `${start + index + 1}. ${songDisplayName(song)}`)

  const embed = new EmbedBuilder()
    .setTitle(`Queue (${total} songs)`)
    .setDescription(lines.join('\n') || 'Empty')
    .setFooter({ text: `Page ${page} of ${pageCount}` })

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`nq:prev:${page}`)
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(`nq:next:${page}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= pageCount),
  )

  return { embed, row }
}

export async function showQueue(channel, queue) {
  if (!channel)
    return

  await withQueuedWrites(queue.id, () => writeQueueView(channel, queue))
  scheduleNowPlayingRepost(queue)
}

async function writeQueueView(channel, queue) {
  const { embed, row } = queueView(queue, 1)
  await deleteTrackedMessage(queueMessages, queue.id, 'old queue message')

  const sent = await channel.send({ embeds: [embed], components: [row] })
  queueMessages.set(queue.id, sent)
}
