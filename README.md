[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/tsu-ld/dj)

# tsu-ld/dj

A Discord bot that plays music in your voice channel. Drop a song name or a link in the assigned text channel and it starts playing, or tag it and talk to it like a DJ: it picks the music and answers in its own voice. Controls live on the now-playing message as buttons, and you can also ask for them in your own words.

## Features

- **Talk to it like a DJ**: tag the bot with a plain request ("poneme algo tranqui de rock nacional") and it chooses the songs, queues them, and answers in character.
- **Personality per server**: ask it to talk a certain way (`@DJ sé un dj cumbiero`) and the setting lives with the server.
- **Play anything**: YouTube links and search terms, and `open.spotify.com` links (track, album, playlist, artist) — the track info comes from Spotify and the audio plays from YouTube. Other pasted links are rejected before they reach yt-dlp.
- **Full control surface**: pause, resume, skip, shuffle, radio (keeps related songs playing after the queue ends), clear (the button asks for confirmation), and a paginated queue view, all as buttons on the now-playing message or by asking `@DJ` in plain language.
- **Playlists**: paste a playlist link and it queues up to 50 songs.
- **Leaves when done**: disconnects when the queue ends (unless radio is on) or the voice channel empties.
- **Remembers its channel**: the listening channel is set per server and survives restarts.
- **Welcome audio**: plays `assets/welcome.mp3` the first time it joins a voice channel each session (optional).

## Tech Stack

- **[Node.js](https://nodejs.org/)**: 24
- **[Bun](https://bun.sh/)**: installs, lints, and runs the test suite
- **Discord**: [discord.js](https://discord.js.org/) + [distube](https://distube.js.org/)
- **Multimedia**: [ffmpeg](https://ffmpeg.org/)
- **Downloader**: [yt-dlp](https://github.com/yt-dlp/yt-dlp) (resolves and downloads YouTube audio)
- **LLM**: any OpenAI-compatible Responses API endpoint (`/responses`) (the DJ's voice and song picks)
- **Decision router (optional)**: [Jev](https://typesafe.ai) through TypeSafe or OpenCode's System One endpoint (fast, typed choice of action)

## Requirements

- **Node.js 24**
- **FFmpeg**: install it and make sure it's on your PATH (distube streams audio through it)
- **yt-dlp**: install it and make sure it's on your PATH (the bot downloads YouTube audio through it)
- **A Discord bot**: create one in the [Discord developer portal](https://discord.com/developers/applications) and invite it to your server with these permissions: Send Messages, Embed Links, Attach Files, Add Reactions, Read Message History, Connect, Speak. Also enable the **Message Content** privileged intent so it can read plain messages in the listening channel.

## Setup

1. **Install dependencies**:

   ```bash
   bun install
   ```

2. **Set the bot token** in the `DISCORD_TOKEN` environment variable:

   ```bash
   export DISCORD_TOKEN=your_bot_token
   ```

3. **(Optional) give it a voice**: point the bot at any OpenAI-compatible Responses API endpoint (`/responses`) so it can talk and pick songs:

   ```bash
   export OPENAI_BASE_URL=https://your-endpoint/v1/responses
   export OPENAI_API_KEY=your_api_key
   export OPENAI_MODEL=your_model  # optional, defaults to deepseek-v4-flash
   ```

   Without these, the bot still plays music: announcements go out as plain text instead of in character, and refusals reply with the plain reason. Tagged song requests still need the LLM; the buttons, Jev-routed controls and plain messages in the listening channel keep working.

4. **(Optional) Spotify credentials**: Spotify links work without them by scraping a web token, which is fragile and can break without warning. Set the credentials from a [Spotify app](https://developer.spotify.com/dashboard) to use the official API:

   ```bash
   export SPOTIFY_CLIENT_ID=your_client_id
   export SPOTIFY_CLIENT_SECRET=your_client_secret
   ```

5. **(Optional) fast action routing with Jev**: point `JEV_BASE_URL` at a System One endpoint. With the official TypeSafe API:

   ```bash
   export JEV_BASE_URL=https://api.typesafe.ai/v1/systemone
   export JEV_MODEL=jev-latest
   export JEV_API_KEY=your_typesafe_key
   ```

   Or with OpenCode's Console endpoint and the same OpenCode key (when its free quota or credits are available):

   ```bash
   export JEV_BASE_URL=https://opencode.ai/inference/systemone/v1/systemone
   export JEV_MODEL=jev-1.13-free  # optional
   # JEV_API_KEY defaults to OPENAI_API_KEY
   ```

   Without it, or when the model is unavailable, the DJ falls back to picking the action with the configured LLM. OpenCode Go's model list does not include Jev yet, so the Console endpoint uses its free quota or credits.

6. **(Optional) welcome audio**: put an MP3 at `assets/welcome.mp3`.

## Run

```bash
bun run start
# or, while developing
bun run dev
```

## Using it

1. **Point it at a channel** (the author needs the Manage Channels permission):

   ```
   @DJ #music
   ```

   The bot replies in that channel from then on and remembers it after restarting.

2. **Play something**: join a voice channel and post a link or search term in the listening channel:

   ```
   never gonna give you up
   ```

3. **Control playback**: the buttons on the now-playing message cover everything. You can also ask in your own words, with no command syntax to memorize:

   ```
   @DJ pausá
   @DJ seguí
   @DJ saltéala
   @DJ mostrame la cola
   @DJ sacá la 3
   ```

4. **Talk to the DJ**: tag it with a song, a mood, a genre or anything else:

   ```
   @DJ poneme algo tranqui para el asado
   ```

   It picks the songs to match the request, queues them, and answers in its own voice. Without the LLM configured, tagged song requests aren't available: the bot replies with the plain reason, and the buttons and plain messages still work.

5. **Set its personality** (the author needs the Manage Server permission; ask in the listening channel):

   ```
   @DJ sé un dj cumbiero que no para de hacer chistes
   ```

   It adopts the personality you describe from then on.

## Testing

- `bun run test` runs the unit tests; `bun test` works too.
- `bun run test:e2e` runs the live end-to-end suite against a real Discord guild. It reads the token and LLM vars from `~/.config/dj/discord.env` (override the path with `E2E_ENV_FILE`) and needs `E2E_GUILD`, `E2E_VOICE` and `E2E_TEXT` set. Stop the bot service first: one Discord session per token.
