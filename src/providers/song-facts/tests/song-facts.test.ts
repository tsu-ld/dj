import type { Logger } from '../../../core/logger.ts'
import type { SongFacts } from '../../../ports/song-facts.ts'
import { describe, expect, test } from 'bun:test'
import { fetchStub, json } from '../../tests/http.ts'
import { songFacts } from '../index.ts'
import { parseNews } from '../news.ts'

const TITLE = 'Daft Punk - One More Time (Official Video)'
const NOW = Date.parse('2026-11-18T12:00:00Z')

// Shapes copied from the live services: Deezer search, Deezer album, a
// Wikipedia page summary and a Google News RSS feed.
const SEARCH_RESULT = {
  data: [
    {
      id: 3135556,
      title: 'One More Time',
      artist: { id: 27, name: 'Daft Punk' },
      album: { id: 302127, title: 'Discovery' },
    },
  ],
}

const ALBUM = {
  id: 302127,
  title: 'Discovery',
  release_date: '2001-03-07',
  label: 'Parlophone',
  genres: { data: [{ id: 106, name: 'Electro' }] },
}

const ARTIST_PAGE = {
  type: 'standard',
  description: 'French electronic music duo',
  extract: 'Daft Punk were a French electronic music duo formed in Paris in 1993. They are known for their helmets.',
}

const SONG_SEARCH = {
  pages: [
    { id: 1, key: 'One_More_Time_(Daft_Punk_song)', title: 'One More Time (Daft Punk song)', description: 'song' },
  ],
}

const SONG_PAGE = {
  type: 'standard',
  description: '2000 single by Daft Punk',
  extract: 'One More Time is a song by the French electronic duo Daft Punk. It was released in 2000. It became a hit.',
}

const NEWS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>"Daft Punk" - Google News</title>
<item>
  <title><![CDATA[Daft Punk announce a new album - BBC]]></title>
  <pubDate>Tue, 17 Nov 2026 08:00:00 GMT</pubDate>
  <source url="https://www.bbc.co.uk">BBC</source>
</item>
<item>
  <title>Daft Punk, an old interview resurfaces - Old Site</title>
  <pubDate>Sat, 01 Jan 2005 08:00:00 GMT</pubDate>
  <source>Old Site</source>
</item>
<item>
  <title>Dua Lipa announces a world tour - Reuters</title>
  <pubDate>Tue, 17 Nov 2026 09:00:00 GMT</pubDate>
  <source>Reuters</source>
</item>
</channel></rss>`

const EMPTY_FEED = '<rss version="2.0"><channel><title>none</title></channel></rss>'

type Handler = (url: string) => Response | Promise<Response>

interface Routes {
  search?: Handler
  album?: Handler
  artist?: Handler
  songSearch?: Handler
  song?: Handler
  news?: Handler
}

interface FakeNet {
  fetch: typeof fetch
  urls: string[]
  userAgents: (string | null)[]
}

function fakeNet(handler: Handler): FakeNet {
  const urls: string[] = []
  const userAgents: (string | null)[] = []

  const stub = fetchStub(async (input, init) => {
    const url = String(input)

    urls.push(url)
    userAgents.push(new Headers(init?.headers).get('User-Agent'))

    return handler(url)
  })

  return { fetch: stub, urls, userAgents }
}

function xml(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } })
}

function network(routes: Routes = {}): FakeNet {
  return fakeNet((url): Response | Promise<Response> => {
    if (url.startsWith('https://api.deezer.com/search'))
      return (routes.search ?? (() => json(SEARCH_RESULT)))(url)

    if (url.startsWith('https://api.deezer.com/album/'))
      return (routes.album ?? (() => json(ALBUM)))(url)

    if (url.startsWith('https://en.wikipedia.org/w/rest.php/v1/search/page'))
      return (routes.songSearch ?? (() => json(SONG_SEARCH)))(url)

    if (url.startsWith('https://en.wikipedia.org/api/rest_v1/page/summary/Daft_Punk'))
      return (routes.artist ?? (() => json(ARTIST_PAGE)))(url)

    if (url.startsWith('https://en.wikipedia.org/api/rest_v1/page/summary/'))
      return (routes.song ?? (() => json(SONG_PAGE)))(url)

    if (url.startsWith('https://news.google.com/'))
      return (routes.news ?? (() => xml(NEWS)))(url)

    return new Response('', { status: 404 })
  })
}

const silent: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silent,
}

function portFor(net: FakeNet, options: { deadlineMs?: number } = {}): ReturnType<typeof songFacts> {
  return songFacts({ logger: silent, fetch: net.fetch, now: () => NOW, deadlineMs: options.deadlineMs })
}

const FRESH_NEWS = { title: 'Daft Punk announce a new album', source: 'BBC', publishedAt: Date.parse('Tue, 17 Nov 2026 08:00:00 GMT') }

const EXPECTED: SongFacts = {
  artist: 'Daft Punk',
  title: 'One More Time',
  album: 'Discovery',
  year: 2001,
  releaseDate: '2001-03-07',
  genre: 'Electro',
  artistSummary: 'Daft Punk were a French electronic music duo formed in Paris in 1993.',
  songSummary: 'One More Time is a song by the French electronic duo Daft Punk. It was released in 2000.',
  news: [FRESH_NEWS],
}

describe('songFacts.lookup', () => {
  test('a matched song comes back with album, date, genre, summaries and news', async () => {
    const net = network()
    const facts = await portFor(net).lookup({ title: TITLE, artist: null })

    expect(facts).toEqual(EXPECTED)
  })

  test('the requests run serially with a descriptive user agent', async () => {
    const net = network()

    await portFor(net).lookup({ title: TITLE, artist: null })

    expect(net.urls).toEqual([
      'https://api.deezer.com/search?q=Daft%20Punk%20One%20More%20Time&limit=5',
      'https://api.deezer.com/album/302127',
      'https://en.wikipedia.org/api/rest_v1/page/summary/Daft_Punk',
      'https://en.wikipedia.org/w/rest.php/v1/search/page?q=One%20More%20Time%20Daft%20Punk%20song&limit=3',
      'https://en.wikipedia.org/api/rest_v1/page/summary/One_More_Time_(Daft_Punk_song)',
      'https://news.google.com/rss/search?q=%22Daft%20Punk%22%20(banda%20OR%20band%20OR%20music%20OR%20m%C3%BAsica%20OR%20song%20OR%20canci%C3%B3n%20OR%20album%20OR%20disco%20OR%20concert%20OR%20show%20OR%20tour%20OR%20gira)&hl=es-419&gl=AR&ceid=AR:es-419',
    ])
    expect(net.userAgents).toEqual(Array.from({ length: 6 }, () => 'dj-discord-bot/1.0 (self-hosted Discord radio)'))
  })

  test('an artist mismatch from a bare track is refused', async () => {
    const net = network({ search: () => json({ data: [{ id: 1, title: 'One More Time', artist: { name: 'Dua Lipa' } }] }) })
    const facts = await portFor(net).lookup({ title: 'One More Time', artist: 'Daft Punk' })

    expect(facts).toBeNull()
    // Without "Artist - Track" in the title, a mismatch leaves nothing to check.
    expect(net.urls.length).toBe(1)
  })

  test('a mismatch with an explicit split still gathers the song summary and news', async () => {
    const net = network({ search: () => json({ data: [{ id: 1, title: 'One More Time', artist: { name: 'Dua Lipa' } }] }) })
    const facts = await portFor(net).lookup({ title: TITLE, artist: null })

    expect(facts?.artist).toBe('Daft Punk')
    expect(facts?.album).toBeNull()
    expect(facts?.artistSummary).toBeNull()
    expect(facts?.songSummary).toBe(EXPECTED.songSummary)
    expect(facts?.news).toEqual(EXPECTED.news)
    expect(net.urls.some(url => url.includes('/album/'))).toBe(false)
  })

  test('a Deezer error payload on HTTP 200 is a miss', async () => {
    const net = network({
      search: () => json({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } }),
      songSearch: () => json({ pages: [] }),
      news: () => xml(EMPTY_FEED),
    })

    expect(await portFor(net).lookup({ title: TITLE, artist: null })).toBeNull()
  })

  test('a missing Wikipedia page leaves the summary null, not the facts', async () => {
    const net = network({ artist: () => new Response('', { status: 404 }) })
    const facts = await portFor(net).lookup({ title: TITLE, artist: null })

    expect(facts?.artistSummary).toBeNull()
    expect(facts?.album).toBe('Discovery')
  })

  test('an artist page that never mentions music is not a summary', async () => {
    const net = network({
      artist: () => json({ type: 'standard', description: 'A town in France', extract: 'Discovery is a town in the Loire valley.' }),
    })
    const facts = await portFor(net).lookup({ title: TITLE, artist: null })

    expect(facts?.artistSummary).toBeNull()
  })

  test('a fetch that never answers gives null inside the deadline', async () => {
    const net = fakeNet(async () => new Promise<Response>(() => {}))
    const started = performance.now()
    const facts = await portFor(net, { deadlineMs: 40 }).lookup({ title: TITLE, artist: null })

    expect(facts).toBeNull()
    expect(performance.now() - started).toBeLessThan(1000)
  })

  test('partial results survive a failing source', async () => {
    const net = network({
      news: () => {
        throw new Error('network down')
      },
    })
    const facts = await portFor(net).lookup({ title: TITLE, artist: null })

    expect(facts?.album).toBe('Discovery')
    expect(facts?.songSummary).toBe(EXPECTED.songSummary)
    expect(facts?.news).toEqual([])
  })

  test('news keeps only recent items that name the artist', async () => {
    const net = network()
    const facts = await portFor(net).lookup({ title: TITLE, artist: null })

    expect(facts?.news).toEqual([FRESH_NEWS])
  })

  test('a hit is served from the cache without fetching again', async () => {
    const net = network()
    const port = portFor(net)

    const first = await port.lookup({ title: TITLE, artist: null })
    const second = await port.lookup({ title: TITLE, artist: null })

    expect(second).toEqual(first)
    expect(net.urls.length).toBe(6)
  })

  test('a miss is cached too, so a wrong title is only searched once', async () => {
    const net = network({ search: () => json({ data: [] }), songSearch: () => json({ pages: [] }), news: () => xml(EMPTY_FEED) })
    const port = portFor(net)

    await port.lookup({ title: TITLE, artist: null })
    await port.lookup({ title: TITLE, artist: null })
    await port.lookup({ title: TITLE, artist: null })

    expect(net.urls.length).toBe(3)
  })
})

describe('songFacts.cached', () => {
  test('it answers null before a lookup and the facts after, without fetching', async () => {
    const net = network()
    const port = portFor(net)

    expect(port.cached({ title: TITLE, artist: null })).toBeNull()

    const facts = await port.lookup({ title: TITLE, artist: null })

    expect(port.cached({ title: TITLE, artist: null })).toEqual(facts)
    expect(net.urls.length).toBe(6)
  })
})

describe('live API regressions', () => {
  // The live search answers {"data":[],"total":0} to q=artist:"A" track:"T".
  test('a plain Deezer query finds a remastered track and reports title_short', async () => {
    const search = (url: string): Response => url.includes('q=artist%3A')
      ? json({ data: [], total: 0 })
      : json({
          data: [{
            id: 7,
            title: 'The Chain (2004 Remaster)',
            title_short: 'The Chain',
            artist: { name: 'Daft Punk' },
            album: { id: 99, title: 'Rumours' },
          }],
        })
    const net = network({ search })
    const facts = await portFor(net).lookup({ title: 'Daft Punk - The Chain (2004 Remaster)', artist: null })

    expect(facts?.title).toBe('The Chain')
    expect(facts?.album).toBe('Discovery')
    expect(facts?.year).toBe(2001)
    expect(facts?.genre).toBe('Electro')
    expect(facts?.artistSummary).toBe(EXPECTED.artistSummary)
    expect(net.urls[0]).toContain('q=Daft%20Punk%20The%20Chain')
  })

  // A search for "<track> <artist> song" answers the artist's own article.
  test('the artist article is not used as the song summary', async () => {
    const net = network({
      songSearch: () => json({
        pages: [
          { key: 'Daft_Punk', title: 'Daft Punk' },
          { key: 'One_More_Time_(song)', title: 'One More Time (song)' },
        ],
      }),
      song: url => url.endsWith('/Daft_Punk') ? json(ARTIST_PAGE) : json(SONG_PAGE),
    })
    const facts = await portFor(net).lookup({ title: TITLE, artist: null })

    expect(facts?.songSummary).toBe('One More Time is a song by the French electronic duo Daft Punk. It was released in 2000.')
  })

  test('a page that never names the track is not a song summary', async () => {
    const net = network({
      songSearch: () => json({ pages: [{ key: 'Daft_Punk', title: 'Daft Punk' }] }),
      song: () => json(ARTIST_PAGE),
    })
    const facts = await portFor(net).lookup({ title: TITLE, artist: null })

    expect(facts?.artistSummary).toBe(EXPECTED.artistSummary)
    expect(facts?.songSummary).toBeNull()
  })

  // "Intoxicados" is also a Spanish adjective: the bare query answered norovirus.
  test('the news query asks for music news on the Argentine edition', async () => {
    const net = network()

    await portFor(net).lookup({ title: TITLE, artist: null })

    const request = net.urls.find(url => url.includes('news.google.com')) ?? ''

    expect(request).toContain('(banda%20OR%20band%20OR%20music%20OR%20m%C3%BAsica')
    expect(request).toContain('hl=es-419')
    expect(request).toContain('gl=AR')
    expect(request).toContain('ceid=AR:es-419')
    expect(request).not.toContain('hl=en-US')
  })
})

describe('review regressions', () => {
  test('a result for another song by the same artist is not a hit', async () => {
    const net = network({
      search: () => json({
        data: [{ id: 1, title: 'Dreams', title_short: 'Dreams', artist: { name: 'Daft Punk' }, album: { id: 9, title: 'Rumours' } }],
      }),
      songSearch: () => json({ pages: [] }),
      news: () => xml(EMPTY_FEED),
    })
    const facts = await portFor(net).lookup({ title: TITLE, artist: null })

    expect(facts).toBeNull()
    expect(net.urls.some(url => url.includes('/album/'))).toBe(false)
  })

  test('an artist that only starts with the wanted name is not a match', async () => {
    const net = network({
      search: () => json({
        data: [{ id: 1, title: 'One More Time', title_short: 'One More Time', artist: { name: 'Airbourne' } }],
      }),
      songSearch: () => json({ pages: [] }),
      news: () => xml(EMPTY_FEED),
    })
    const facts = await portFor(net).lookup({ title: 'Air - One More Time', artist: null })

    expect(facts).toBeNull()
  })

  test('news drops a headline that only starts with the artist name', () => {
    const feed = '<rss><channel><item><title>Airbourne announce a tour - Site</title><pubDate>Tue, 17 Nov 2026 08:00:00 GMT</pubDate></item></channel></rss>'

    expect(parseNews(feed, 'Air', NOW)).toEqual([])
  })

  test('two concurrent lookups share one set of requests', async () => {
    const net = network()
    const port = portFor(net)
    const [first, second] = await Promise.all([
      port.lookup({ title: TITLE, artist: null }),
      port.lookup({ title: TITLE, artist: null }),
    ])

    expect(second).toEqual(first)
    expect(net.urls.length).toBe(6)
  })

  test('a partial answer is cached for an hour, not a day', async () => {
    let clock = NOW
    const net = network({ news: () => new Response('', { status: 429 }) })
    const port = songFacts({ logger: silent, fetch: net.fetch, now: () => clock })
    const facts = await port.lookup({ title: TITLE, artist: null })

    expect(facts?.album).toBe('Discovery')

    clock = NOW + 2 * 60 * 60 * 1000
    expect(port.cached({ title: TITLE, artist: null })).toBeNull()
  })

  test('a complete answer survives the same two hours', async () => {
    let clock = NOW
    const net = network()
    const port = songFacts({ logger: silent, fetch: net.fetch, now: () => clock })

    await port.lookup({ title: TITLE, artist: null })

    clock = NOW + 2 * 60 * 60 * 1000
    expect(port.cached({ title: TITLE, artist: null })).not.toBeNull()
  })

  test('the deadline keeps what the album already answered', async () => {
    const net = network({ artist: async () => new Promise<Response>(() => {}) })
    const port = portFor(net, { deadlineMs: 60 })
    const started = performance.now()
    const facts = await port.lookup({ title: TITLE, artist: null })

    expect(performance.now() - started).toBeLessThan(1000)
    expect(facts?.album).toBe('Discovery')
    expect(facts?.year).toBe(2001)
    expect(facts?.artistSummary).toBeNull()
    expect(port.cached({ title: TITLE, artist: null })).toEqual(facts)
  })

  test('a malformed numeric entity does not throw out of the feed', () => {
    const feed = '<rss><channel><item><title>Daft Punk &#99999999; return - BBC</title><pubDate>Tue, 17 Nov 2026 08:00:00 GMT</pubDate><source>BBC</source></item></channel></rss>'
    const items = parseNews(feed, 'Daft Punk', NOW)

    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('Daft Punk  return')
  })
})

// Live Google News answers a one-word act with the word's other life: a
// monarch, a city, a gas, a gesture. A doubtful headline is dropped, not read
// out as a fact.
function headline(title: string, source = 'Site'): string {
  return `<rss><channel><item><title>${title} - ${source}</title><pubDate>Tue, 17 Nov 2026 08:00:00 GMT</pubDate><source>${source}</source></item></channel></rss>`
}

describe('common-word artists', () => {
  test('a headline that uses the name as an ordinary word is dropped', () => {
    expect(parseNews(headline('Queen Camilla visits hospital'), 'Queen', NOW)).toEqual([])
    expect(parseNews(headline('Chicago weather: snow until Friday'), 'Chicago', NOW)).toEqual([])
    expect(parseNews(headline('Air India flight delayed'), 'Air', NOW)).toEqual([])
    expect(parseNews(headline('Kiss between strangers caught on camera'), 'Kiss', NOW)).toEqual([])
  })

  // The live Chicago and Air feeds: the word belongs to a team or an air show.
  test('a one-word name inside another proper noun is dropped, music word or not', () => {
    expect(parseNews(headline('Cada visita de Chicago Fire ya es parte del tour Lewandowski', 'MLS Español'), 'Chicago', NOW)).toEqual([])
    expect(parseNews(headline('El Fort Lauderdale Air Show 2026 recibe 350.000 visitantes', 'Univision'), 'Air', NOW)).toEqual([])
  })

  test('an accented one-word name is matched against the accented headline', () => {
    expect(parseNews(headline('Björk Reykjavik Airport opens a music hall'), 'Björk', NOW)).toEqual([])
    expect(parseNews(headline('Björk anuncia un nuevo disco'), 'Björk', NOW)).toHaveLength(1)
  })

  // The live Chicago feed also answers with the outlet's own name in the title.
  test('a headline that names the artist only in the outlet is dropped', () => {
    expect(parseNews(headline('Garbage sella 30 años de historia con México', 'Chicago Tribune'), 'Chicago', NOW)).toEqual([])
  })

  test('a music headline for the same act is kept', () => {
    expect(parseNews(headline('Queen\'s Brian May announces new album'), 'Queen', NOW).map(item => item.title))
      .toEqual(['Queen\'s Brian May announces new album'])
    expect(parseNews(headline('Kiss farewell concert film'), 'Kiss', NOW).map(item => item.title))
      .toEqual(['Kiss farewell concert film'])
    expect(parseNews(headline('Kiss estrenará un documental sobre su último concierto'), 'Kiss', NOW).map(item => item.title))
      .toEqual(['Kiss estrenará un documental sobre su último concierto'])
  })

  test('a word with an everyday sense does not make a headline about music', () => {
    expect(parseNews(headline('The Queen begins royal tour of Italy'), 'Queen', NOW)).toEqual([])
    expect(parseNews(headline('Chicago single mother wins lottery'), 'Chicago', NOW)).toEqual([])
    expect(parseNews(headline('Air quality back on track'), 'Air', NOW)).toEqual([])
  })

  test('a distinctive multi-word billing still needs no music word', () => {
    expect(parseNews(headline('Daft Punk spotted in Paris'), 'Daft Punk', NOW)).toHaveLength(1)
  })
})
