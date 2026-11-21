const RECENT_TITLES = 30

interface RecentTitles {
  readonly add: (guildId: string, title: string) => void
  readonly of: (guildId: string) => ReadonlyArray<string>
}

function withoutUploadVariantNotes(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s-\s[^-]*\bremaster(?:ed)?\b[^-]*$/, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

export function titleKeys(title: string): Array<string> {
  const bare = withoutUploadVariantNotes(title)
  const dash = bare.indexOf(' - ')
  const name = dash === -1 ? '' : bare.slice(dash + 3).trim()

  return [bare, name].filter((key) => key !== '')
}

export function sameSong(title: string, heard: ReadonlySet<string>): boolean {
  return titleKeys(title).some((key) => heard.has(key))
}

export function recentTitles(): RecentTitles {
  const byGuild = new Map<string, Array<string>>()

  return {
    add(guildId, title) {
      byGuild.set(guildId, [...(byGuild.get(guildId) ?? []), title].slice(-RECENT_TITLES))
    },
    of(guildId) {
      return byGuild.get(guildId) ?? []
    },
  }
}
