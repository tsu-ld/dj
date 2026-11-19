import { describe, expect, test } from 'bun:test'
import { artistMatches, cacheKey, containsWords, mentionsName, parseTitle, stripDecorations, titleMatches } from '../title.ts'

describe('stripDecorations', () => {
  test('production notes in brackets are dropped', () => {
    expect(stripDecorations('One More Time (Official Video)')).toBe('One More Time')
    expect(stripDecorations('One More Time (Official Music Video)')).toBe('One More Time')
    expect(stripDecorations('One More Time [Audio]')).toBe('One More Time')
    expect(stripDecorations('One More Time (Lyrics)')).toBe('One More Time')
    expect(stripDecorations('One More Time (Remastered 2009)')).toBe('One More Time')
    expect(stripDecorations('One More Time (HD)')).toBe('One More Time')
  })

  test('a channel name after a pipe is dropped', () => {
    expect(stripDecorations('One More Time (Official Video) | Daft Punk VEVO')).toBe('One More Time')
  })

  test('a song named after a decoration word survives', () => {
    expect(stripDecorations('Lana Del Rey - Video Games')).toBe('Lana Del Rey - Video Games')
  })

  test('a featured credit is dropped', () => {
    expect(stripDecorations('Get Lucky (feat. Pharrell Williams)')).toBe('Get Lucky')
    expect(stripDecorations('Get Lucky [ft. Pharrell Williams]')).toBe('Get Lucky')
  })
})

describe('parseTitle', () => {
  test('a decorated YouTube title becomes artist and track', () => {
    expect(parseTitle('Daft Punk - One More Time (Official Video)', null)).toEqual({
      artist: 'Daft Punk',
      title: 'One More Time',
      explicit: true,
    })
  })

  test('a featured credit on the track is dropped', () => {
    expect(parseTitle('Daft Punk - Get Lucky ft. Pharrell Williams', null)).toEqual({
      artist: 'Daft Punk',
      title: 'Get Lucky',
      explicit: true,
    })
  })

  test('a bare track falls back to the caller artist without an explicit split', () => {
    expect(parseTitle('One More Time [Audio]', 'Daft Punk')).toEqual({
      artist: 'Daft Punk',
      title: 'One More Time',
      explicit: false,
    })
  })

  test('no artist anywhere stays null', () => {
    expect(parseTitle('One More Time', null)).toEqual({ artist: null, title: 'One More Time', explicit: false })
  })
})

describe('artistMatches', () => {
  test('case and accents do not separate the same act', () => {
    expect(artistMatches('Beyonce', 'Beyoncé')).toBe(true)
    expect(artistMatches('DAFT PUNK', 'Daft Punk')).toBe(true)
  })

  test('a longer billing still names the same act', () => {
    expect(artistMatches('Calvin Harris feat. Rihanna', 'Calvin Harris')).toBe(true)
  })

  test('a different act is a mismatch', () => {
    expect(artistMatches('Dua Lipa', 'Daft Punk')).toBe(false)
    expect(artistMatches('', 'Daft Punk')).toBe(false)
  })
})

describe('mentionsName', () => {
  test('a summary that names the artist is accepted', () => {
    expect(mentionsName('One More Time is a song by the French duo Daft Punk.', 'Daft Punk')).toBe(true)
    expect(mentionsName('One More Time is a song by Dua Lipa.', 'Daft Punk')).toBe(false)
  })
})

describe('cacheKey', () => {
  test('the same song in different casing shares one key', () => {
    expect(cacheKey({ artist: 'Daft Punk', title: 'One More Time', explicit: true }))
      .toBe(cacheKey({ artist: 'daft punk', title: 'one more time', explicit: true }))
  })
})

describe('word boundaries', () => {
  test('a name is not a prefix of another name', () => {
    expect(artistMatches('Airbourne', 'Air')).toBe(false)
    expect(artistMatches('Siamese', 'Sia')).toBe(false)
    expect(containsWords('Airbourne announced a tour', 'Air')).toBe(false)
    expect(containsWords('Air announced a tour', 'Air')).toBe(true)
  })

  test('a remaster suffix still names the same track', () => {
    expect(titleMatches('The Chain', 'The Chain (2004 Remaster)')).toBe(true)
    expect(titleMatches('Dreams', 'The Chain (2004 Remaster)')).toBe(false)
  })
})
