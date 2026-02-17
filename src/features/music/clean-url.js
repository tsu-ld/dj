export function cleanUrl(content) {
  try {
    const url = new URL(content)

    if (!url.hostname.includes('youtube.com') && !url.hostname.includes('youtu.be'))
      return content

    const videoId = url.searchParams.get('v')
    if (videoId)
      return `https://www.youtube.com/watch?v=${videoId}`

    if (url.hostname.includes('youtu.be') && url.pathname.length > 1)
      return `https://www.youtube.com/watch?v=${url.pathname.slice(1)}`

    return content
  }
  catch {
    return content
  }
}
