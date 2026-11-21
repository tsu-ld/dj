import type { PreparedClips } from '../clips.ts'
import { describe, expect, test } from 'bun:test'
import { PREPARED_CLIP_TTL_MS } from '../../limits.ts'
import { testClock } from '../../tests/fixtures.ts'
import { preparedClips } from '../clips.ts'

type Clip = Parameters<PreparedClips['setPrepared']>[1]

function clip(songId: string, key = 'k'): Clip {
  return { songId, key, file: `/tmp/${songId}.mp3`, angle: 'run', text: `line ${songId}` }
}

describe('prepared clips', () => {
  test('a fresh clip belongs to exactly one song', () => {
    const clips = preparedClips(testClock())

    expect(clips.setPrepared('g1', clip('a'))).toBeNull()
    expect(clips.preparedFor('g1', 'a', 'k')).toBe(true)
    expect(clips.preparedFor('g1', 'b', 'k')).toBe(false)

    const taken = clips.takePrepared('g1', 'a', 'k')

    expect(taken.clip?.file).toBe('/tmp/a.mp3')
    expect(taken.clip?.text).toBe('line a')
    expect(taken.discarded).toBeNull()
    expect(clips.preparedFor('g1', 'a', 'k')).toBe(false)
  })

  test('a clip for another song is discarded, file and all', () => {
    const clips = preparedClips(testClock())

    clips.setPrepared('g1', clip('b'))

    const taken = clips.takePrepared('g1', 'c', 'k')

    expect(taken.clip).toBeNull()
    expect(taken.discarded?.file).toBe('/tmp/b.mp3')
  })

  test('a clip written from other facts is not prepared and is discarded', () => {
    const clips = preparedClips(testClock())

    clips.setPrepared('g1', clip('b', 'before shuffle'))

    expect(clips.preparedFor('g1', 'b', 'after shuffle')).toBe(false)

    const taken = clips.takePrepared('g1', 'b', 'after shuffle')

    expect(taken.clip).toBeNull()
    expect(taken.discarded?.file).toBe('/tmp/b.mp3')
  })

  test('a clip expires after twenty minutes', () => {
    const clock = testClock()
    const clips = preparedClips(clock)

    clips.setPrepared('g1', clip('a'))
    clock.advance(PREPARED_CLIP_TTL_MS)

    expect(clips.takePrepared('g1', 'a', 'k').clip?.file).toBe('/tmp/a.mp3')

    clips.setPrepared('g1', clip('a'))
    clock.advance(PREPARED_CLIP_TTL_MS + 1)

    const expired = clips.takePrepared('g1', 'a', 'k')

    expect(expired.clip).toBeNull()
    expect(expired.discarded?.file).toBe('/tmp/a.mp3')
  })

  test('replacing a clip hands back the old one for deletion', () => {
    const clips = preparedClips(testClock())

    clips.setPrepared('g1', clip('a'))

    const previous = clips.setPrepared('g1', clip('b'))

    expect(previous?.file).toBe('/tmp/a.mp3')
    expect(clips.preparedFor('g1', 'b', 'k')).toBe(true)
  })

  test('dropping a guild hands its clip back for deletion', () => {
    const clips = preparedClips(testClock())

    clips.setPrepared('g1', clip('b'))

    const dropped = clips.drop('g1')

    expect(dropped?.file).toBe('/tmp/b.mp3')
    expect(clips.preparedFor('g1', 'b', 'k')).toBe(false)
  })

  test('clearing hands every clip back for deletion', () => {
    const clips = preparedClips(testClock())

    clips.setPrepared('g1', clip('a'))
    clips.setPrepared('g2', clip('b'))

    const files = clips.clear().map((cleared) => cleared.file)

    expect(files.toSorted()).toEqual(['/tmp/a.mp3', '/tmp/b.mp3'])
    expect(clips.preparedFor('g1', 'a', 'k')).toBe(false)
  })
})
