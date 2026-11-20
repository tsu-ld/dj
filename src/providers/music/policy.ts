import { MESSAGES } from '../../messages.ts'

// mirrors distube's isURL, which picks between resolve() and search
const URL_PROTOCOLS = new Set(['http:', 'https:', 'file:'])
const MUSIC_PROTOCOLS = new Set(['http:', 'https:'])
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])
const SPOTIFY_HOSTS = new Set(['open.spotify.com'])
const MUSIC_HOSTS = new Set([...YOUTUBE_HOSTS, ...SPOTIFY_HOSTS])

type PolicyCode = 'UNSUPPORTED_URL' | 'LIVE_UNSUPPORTED'

export class PolicyError extends Error {
  readonly code: PolicyCode

  constructor(code: PolicyCode, message: string) {
    super(message)
    this.name = 'PolicyError'
    this.code = code
  }
}

export function isUrlLike(input: string): boolean {
  if (input.includes(' '))
    return false

  try {
    return URL_PROTOCOLS.has(new URL(input).protocol)
  }
  catch {
    return false
  }
}

function isHostAllowed(input: string, hosts: ReadonlySet<string>): boolean {
  if (!isUrlLike(input))
    return false

  const { protocol, hostname } = new URL(input)

  return MUSIC_PROTOCOLS.has(protocol) && hosts.has(hostname)
}

export function isSupportedMusicUrl(input: string): boolean {
  return isHostAllowed(input, MUSIC_HOSTS)
}

export function isYoutubeUrl(input: string): boolean {
  return isHostAllowed(input, YOUTUBE_HOSTS)
}

export function assertYoutubeUrl(input: string): void {
  if (isUrlLike(input) && !isYoutubeUrl(input))
    throw new PolicyError('UNSUPPORTED_URL', MESSAGES.unsupportedUrl)
}

export function liveError(): PolicyError {
  return new PolicyError('LIVE_UNSUPPORTED', MESSAGES.liveUnsupported)
}
