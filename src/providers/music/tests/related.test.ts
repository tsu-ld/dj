import type { GuildMember } from 'discord.js'
import type { DisTube } from 'distube'
import { expect, test } from 'bun:test'
import { Song } from 'distube'
import { silentLog as log } from '../../../tests/fixtures.ts'
import { MusicCatalog } from '../catalog.ts'
import { extractionStub, memberOf, streamStub } from './fakes.ts'

const MIX = [
  { id: 'remaster', title: 'The Chain (2004 Remaster)', channel: 'Fleetwood Mac - Topic' },
  { id: 'reupload', title: 'Fleetwood Mac - The Chain - Remastered 2004' },
  { id: 'video', title: 'Fleetwood Mac - The Chain [Official Video]' },
  { id: 'queued', title: 'Go Your Own Way (Official Music Video)' },
  { id: 'dreams', title: 'Dreams (2004 Remaster)' },
]

function catalogWithMix(): MusicCatalog {
  return new MusicCatalog({
    extraction: extractionStub({ json: async () => ({ entries: MIX }) }),
    stream: streamStub(),
    logger: log,
  })
}

function memberIn(guildId: string): GuildMember {
  return { ...memberOf('200000000000000007', 'tsu'), guild: { id: guildId } } as unknown as GuildMember
}

test('autoplay skips remasters and re-uploads of a song the guild just heard', async () => {
  const catalog = catalogWithMix()
  const member = memberOf('200000000000000007', 'tsu')
  const played = catalog.buildSong({ id: 'chain', title: 'The Chain' }, { member })

  await catalog.getStreamURL(played)
  const related = await catalog.getRelatedSongs({ id: 'other', name: 'Rhiannon', member })

  expect(related.map(song => song.id)).toEqual(['queued', 'dreams', 'remaster', 'reupload', 'video'])
})

test('autoplay skips another copy of the song it is relating to', async () => {
  const related = await catalogWithMix().getRelatedSongs({ id: 'chain', name: 'Fleetwood Mac - The Chain (Official Audio)' })

  expect(related.map(song => song.id)).toEqual(['queued', 'dreams', 'remaster', 'reupload', 'video'])
})

test('autoplay skips a song already in the queue', async () => {
  const catalog = catalogWithMix()
  const member = memberOf('200000000000000007', 'tsu')
  const queued = new Song({ plugin: null, source: 'spotify', playFromSource: false, id: 'sp', name: 'Go Your Own Way', uploader: {} }, {})
  const engine = { getQueue: (guildId: string) => guildId === member.guild.id ? { songs: [queued] } : undefined }

  catalog.init(engine as unknown as DisTube)

  const related = await catalog.getRelatedSongs({ id: 'x', name: 'Landslide', member })

  expect(related.map(song => song.id)).toEqual(['remaster', 'reupload', 'video', 'dreams', 'queued'])
})

test('a radio that has heard the whole mix replays from it instead of running dry', async () => {
  const catalog = catalogWithMix()
  const member = memberOf('200000000000000007', 'tsu')

  for (const entry of MIX)
    await catalog.getStreamURL(catalog.buildSong({ id: `${entry.id}-played`, title: entry.title }, { member }))

  const related = await catalog.getRelatedSongs({ id: 'x', name: 'Landslide', member })

  expect(related.map(song => song.id)).toEqual(MIX.map(entry => entry.id))
})

test('heard entries stay behind the fresh ones, so the engine still finds a song when the fresh ones already played this session', async () => {
  const catalog = catalogWithMix()
  const member = memberOf('200000000000000007', 'tsu')

  await catalog.getStreamURL(catalog.buildSong({ id: 'chain', title: 'The Chain' }, { member }))

  const related = await catalog.getRelatedSongs({ id: 'x', name: 'Landslide', member })
  const playedThisSession = new Set(['queued', 'dreams'])

  expect(related.find(song => !playedThisSession.has(song.id))?.id).toBe('remaster')
})

test('what one guild heard does not filter another guild\'s autoplay', async () => {
  const catalog = catalogWithMix()
  const played = catalog.buildSong({ id: 'chain', title: 'The Chain' }, { member: memberIn('100000000000000001') })

  await catalog.getStreamURL(played)

  const related = await catalog.getRelatedSongs({ id: 'x', name: 'Landslide', member: memberIn('100000000000000002') })

  expect(related.map(song => song.id)).toEqual(MIX.map(entry => entry.id))
})
