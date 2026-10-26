import { MESSAGES } from '../messages/en.js'

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

export function isUrlLike(input) {
  if (typeof input !== 'string' || input.includes(' '))
    return false

  try {
    return URL_PROTOCOLS.has(new URL(input).protocol)
  }
  catch {
    return false
  }
}

function isPrivateHost(host) {
  if (host === 'localhost' || host.endsWith('.local') || host === '::1' || host === '[::1]')
    return true

  const octets = host.split('.').map(Number)

  if (octets.length !== 4 || !octets.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255))
    return false

  const [first, second] = octets

  return first === 0 || first === 10 || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
}

function isHostAllowed(input, hosts) {
  if (!isUrlLike(input))
    return false

  const { protocol, hostname } = new URL(input)

  return MUSIC_PROTOCOLS.has(protocol) && !isPrivateHost(hostname) && hosts.has(hostname)
}

export function isSupportedMusicUrl(input) {
  return isHostAllowed(input, MUSIC_HOSTS)
}

function unsupportedUrlError() {
  const error = new Error(MESSAGES.unsupportedUrl)
  error.code = 'UNSUPPORTED_URL'
  error.errorCode = 'UNSUPPORTED_URL'

  return error
}

export function assertSupportedMusicUrl(input) {
  if (isUrlLike(input) && !isSupportedMusicUrl(input))
    throw unsupportedUrlError()
}

export function assertYtDlpUrl(input) {
  if (isUrlLike(input) && !isHostAllowed(input, YOUTUBE_HOSTS))
    throw unsupportedUrlError()
}

export function liveError() {
  const error = new Error(MESSAGES.liveUnsupported)
  error.code = 'LIVE_UNSUPPORTED'
  error.errorCode = 'LIVE_UNSUPPORTED'

  return error
}
