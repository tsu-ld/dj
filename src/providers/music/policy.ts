import { MESSAGES } from '../../messages.ts'

// distube decides between resolve() and search with its own isURL, which accepts
// http, https and file and refuses strings with spaces; mirror that so a search
// phrase that happens to contain a URL is treated the same way here.
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

export type PolicyCode = 'UNSUPPORTED_URL' | 'LIVE_UNSUPPORTED'

export class PolicyError extends Error {
  readonly code: PolicyCode
  // The extractor library reads errorCode; the code field is what the tests and
  // our own play path inspect. Both carry the same value.
  readonly errorCode: PolicyCode

  constructor(code: PolicyCode, message: string) {
    super(message)
    this.name = 'PolicyError'
    this.code = code
    this.errorCode = code
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

function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.local') || host === '::1' || host === '[::1]')
    return true

  const octets = host.split('.').map(Number)

  if (octets.length !== 4 || !octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255))
    return false

  const [first, second] = octets

  return first === 0 || first === 10 || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second !== undefined && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
}

function isHostAllowed(input: string, hosts: ReadonlySet<string>): boolean {
  if (!isUrlLike(input))
    return false

  const { protocol, hostname } = new URL(input)

  return MUSIC_PROTOCOLS.has(protocol) && !isPrivateHost(hostname) && hosts.has(hostname)
}

export function isSupportedMusicUrl(input: string): boolean {
  return isHostAllowed(input, MUSIC_HOSTS)
}

export function isYoutubeUrl(input: string): boolean {
  return isHostAllowed(input, YOUTUBE_HOSTS)
}

function unsupportedUrlError(): PolicyError {
  return new PolicyError('UNSUPPORTED_URL', MESSAGES.unsupportedUrl)
}

export function assertSupportedMusicUrl(input: string): void {
  if (isUrlLike(input) && !isSupportedMusicUrl(input))
    throw unsupportedUrlError()
}

export function assertYoutubeUrl(input: string): void {
  if (isUrlLike(input) && !isYoutubeUrl(input))
    throw unsupportedUrlError()
}

export function liveError(): PolicyError {
  return new PolicyError('LIVE_UNSUPPORTED', MESSAGES.liveUnsupported)
}
