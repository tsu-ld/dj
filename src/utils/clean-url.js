export function cleanUrl(content) {
  try {
    const url = new URL(content)
    // Only clean YouTube URLs
    if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
      // Check for 'v' parameter (standard youtube.com/watch?v=...)
      const videoId = url.searchParams.get('v')
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`
      }
      
      // Handle short youtu.be/ID format just in case, though usually these don't have bad params
      if (url.hostname.includes('youtu.be') && url.pathname.length > 1) {
        return `https://www.youtube.com/watch?v=${url.pathname.slice(1)}`
      }
    }
    return content
  }
  catch {
    // If it's not a valid URL (e.g. a search query "d  espacito"), return as is
    return content
  }
}
