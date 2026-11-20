import { SpotifyPlugin } from '@distube/spotify'
import { expect, test } from 'bun:test'
import { Client, GatewayIntentBits } from 'discord.js'
import { DisTube, Playlist, Song } from 'distube'
import { MAX_PLAYLIST_SONGS } from '../../../limits.ts'
import { MusicCatalog } from '../catalog.ts'
import { MetadataCatalog } from '../metadata.ts'
import { extractionStub, log, rejection, streamStub } from './fakes.ts'

const PLAYLIST_URL = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'

function scrapedSpotify(count: number): SpotifyPlugin {
  const plugin = new SpotifyPlugin()

  Object.assign(plugin.api, {
    getData: async () => ({
      type: 'playlist',
      name: 'Big list',
      url: PLAYLIST_URL,
      tracks: Array.from({ length: count }, (_, index) => ({
        type: 'track',
        id: `track${index}`,
        name: `Song ${index}`,
        artists: [{ name: 'Band' }],
        duration: 200_000,
      })),
    }),
  })

  return plugin
}

function engineWith(json: (url: string) => Promise<unknown>): DisTube {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] })
  const catalog = new MusicCatalog({ extraction: extractionStub({ json }), stream: streamStub(), logger: log })

  return new DisTube(client, { plugins: [new MetadataCatalog({ source: scrapedSpotify(120), logger: log }), catalog] })
}

test('a spotify playlist reaches the engine as a playlist of playable songs, capped', async () => {
  const player = engineWith(async () => ({}))
  const resolved = await player.handler.resolve(PLAYLIST_URL)

  expect(resolved).toBeInstanceOf(Playlist)

  if (!(resolved instanceof Playlist))
    throw new Error('expected a playlist')

  expect(resolved.songs).toHaveLength(MAX_PLAYLIST_SONGS)
  expect(resolved.songs.every(song => song instanceof Song && song.stream.playFromSource === false)).toBe(true)
  expect(resolved.songs[0]?.name).toBe('Song 0')
  expect(resolved.songs[0]?.uploader.name).toBe('Band')
  expect(resolved.songs[0]?.duration).toBe(200)
})

test('a spotify song with no youtube match fails alone with NO_RESULT, which the engine skips', async () => {
  const searched: string[] = []
  const player = engineWith(async (url) => {
    searched.push(url)

    return { entries: [] }
  })
  const resolved = await player.handler.resolve(PLAYLIST_URL)

  if (!(resolved instanceof Playlist))
    throw new Error('expected a playlist')

  const [first] = resolved.songs

  if (!first)
    throw new Error('expected a song')

  expect(await rejection(async () => player.handler.attachStreamInfo(first))).toContain('Song 0 Band')
  expect(searched.some(url => url.includes('Song+0+Band') || url.includes('Song 0 Band'))).toBe(true)
})
