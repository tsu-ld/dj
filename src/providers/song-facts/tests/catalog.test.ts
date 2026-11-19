import { expect, test } from 'bun:test'
import { albumFacts } from '../catalog.ts'

const dated = (releaseDate: string) => albumFacts({ title: 'Discovery', release_date: releaseDate }, null)

test('a real release date is kept with its year', () => {
  expect(dated('2001-03-07')).toMatchObject({ releaseDate: '2001-03-07', year: 2001 })
})

test('a placeholder or impossible release date says nothing', () => {
  for (const raw of ['0000-00-00', '2001-00-07', '2001-03-00', '1899-03-07', '2101-03-07'])
    expect(dated(raw)).toMatchObject({ album: 'Discovery', releaseDate: null, year: null })
})
