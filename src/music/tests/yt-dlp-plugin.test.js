import process from 'node:process'
import { expect, test } from 'bun:test'
import { MESSAGES } from '../../messages/en.js'
import { finishedAudioFile, runYtDlp, safeFileId, YtDlpPlugin } from '../yt-dlp-plugin.js'

test('a partially downloaded song is not playable', () => {
  const files = ['def456.m4a.part', 'abc123.webm', 'abc123.m4a.part']

  expect(finishedAudioFile(files, 'abc123')).toBe('abc123.webm')
})

test('the finished audio file is found by id', () => {
  expect(finishedAudioFile(['abc123.m4a'], 'abc123')).toBe('abc123.m4a')
})

test('files belonging to other songs are ignored', () => {
  expect(finishedAudioFile(['def456.m4a', 'abc123.m4a.part', 'xyz789.webm'], 'abc123')).toBeUndefined()
})

test('partial and legacy ytdl downloads are never played', () => {
  expect(finishedAudioFile(['abc123.webm.part'], 'abc123')).toBeUndefined()
  expect(finishedAudioFile(['abc123.webm.ytdl'], 'abc123')).toBeUndefined()
})

test('a file id is sanitized before it reaches a path', () => {
  expect(safeFileId('abc123')).toBe('abc123')
  expect(safeFileId('../../etc/passwd')).toBe('______etc_passwd')
  expect(finishedAudioFile(['abc123.m4a'], safeFileId('../abc123'))).toBeUndefined()
})

test('a flat playlist entry keeps its watch url', () => {
  const song = new YtDlpPlugin().buildSong({ _type: 'url', id: 'abc123', url: 'https://www.youtube.com/watch?v=abc123', title: 'Related song' }, {})

  expect(song.url).toBe('https://www.youtube.com/watch?v=abc123')
})

test('live and upcoming streams are marked live', () => {
  const plugin = new YtDlpPlugin()

  expect(plugin.buildSong({ id: 'a', title: 'live', live_status: 'is_live' }, {}).isLive).toBe(true)
  expect(plugin.buildSong({ id: 'b', title: 'soon', live_status: 'is_upcoming' }, {}).isLive).toBe(true)
  expect(plugin.buildSong({ id: 'c', title: 'recorded', is_live: true }, {}).isLive).toBe(true)
})

test('resolve rejects urls the extractor cannot handle', async () => {
  await expect(new YtDlpPlugin().resolve('https://example.com/watch?v=abc123', {}))
    .rejects
    .toThrow(MESSAGES.unsupportedUrl)
})

test('related songs need a video id', async () => {
  expect(await new YtDlpPlugin().getRelatedSongs({})).toEqual([])
})

test('a hung yt-dlp process is killed at the timeout', async () => {
  await expect(runYtDlp(['-e', 'setTimeout(() => {}, 10000)'], {
    command: process.execPath,
    timeoutMs: 50,
  })).rejects.toThrow(/timed out/)
})
