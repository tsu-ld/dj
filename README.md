[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/tsu-ld/dj)

# tsu-ld/dj

A Discord bot that plays music in your voice channel. Drop a song name or a link in the assigned text channel and it starts playing, or tag it and talk to it like a DJ: it picks the music, answers in its own voice and keeps the radio running.

## Features

- **Talk to it like a DJ**: tag the bot with a plain request ("poneme algo tranqui de rock nacional") and it chooses the songs, queues them and answers in character.
- **Radio voice**: with a voice configured, the DJ speaks in the gap before a song starts and never over it. One song in three runs without a line, autoplay songs talk less, and every fifth line is a longer radio rant.
- **Personality per server**: ask it to talk a certain way (`@DJ sé un dj cumbiero`) and the setting lives with the server.
- **Play anything**: YouTube links and search terms, and `open.spotify.com` links (track, album, playlist, artist). Other pasted links are rejected before they reach the extractor.
- **Full control surface**: pause, resume, skip, shuffle, radio, clear (the button asks for confirmation) and a paginated queue view, as buttons on the now-playing message or by asking `@DJ` in plain language.
- **Playlists**: paste a playlist link and it queues up to 50 songs.
- **Leaves when done**: disconnects when the queue ends (unless radio is on) or the voice channel empties.
- **Remembers its channel**: the listening channel and persona are per server; they survive restarts, and the old settings file is migrated automatically.
- **Welcome audio**: plays `assets/welcome.mp3` the first time it joins a voice channel each session (optional).

## Tech Stack

- **[Bun](https://bun.sh/) 1.4+**: runs the TypeScript sources natively (no build step), installs dependencies, lints and runs the tests
- **[TypeScript](https://www.typescriptlang.org/)**: explicit ports and state types, checked in CI with `tsc --noEmit`
- **Discord**: [discord.js](https://discord.js.org/) + [distube](https://distube.js.org/)
- **Multimedia**: [ffmpeg](https://ffmpeg.org/) on `PATH`
- **Downloader**: [yt-dlp](https://github.com/yt-dlp/yt-dlp) on `PATH`
- **LLM**: any OpenAI-compatible Responses API endpoint (`/responses`) for the DJ's voice and song picks
- **Decision router (optional)**: [Jev](https://typesafe.ai) through TypeSafe or OpenCode's System One endpoint

The internals are described in [docs/architecture.md](docs/architecture.md): capability ports, providers, one command bus, a station state machine and a tested dependency rule.

## Requirements

- **Bun 1.4+**
- **FFmpeg** on `PATH`
- **yt-dlp** on `PATH`
- **A Discord bot**: create one in the [Discord developer portal](https://discord.com/developers/applications) and invite it with Send Messages, Embed Links, Attach Files, Add Reactions, Read Message History, Connect and Speak. Enable the **Message Content** privileged intent.

## Setup

1. **Install dependencies**:

   ```bash
   bun install
   ```

2. **Set the bot token**:

   ```bash
   export DISCORD_TOKEN=your_bot_token
   ```

3. **(Optional) give it a voice**: point the bot at any OpenAI-compatible Responses API endpoint (`/responses`):

   ```bash
   export OPENAI_BASE_URL=https://your-endpoint/v1/responses
   export OPENAI_API_KEY=your_api_key
   export OPENAI_MODEL=your_model  # optional, defaults to deepseek-v4-flash
   ```

   Without these, the bot still plays music: announcements go out as plain text, refusals keep their plain reason, and tagged song requests are unavailable. The buttons, fast-routed controls and plain messages in the listening channel keep working.

4. **(Optional) Spotify credentials**: Spotify links work without them by scraping a web token, which is fragile. Set the credentials from a [Spotify app](https://developer.spotify.com/dashboard) to use the official API:

   ```bash
   export SPOTIFY_CLIENT_ID=your_client_id
   export SPOTIFY_CLIENT_SECRET=your_client_secret
   ```

5. **(Optional) fast action routing**: point `JEV_BASE_URL` at a System One endpoint. With the official TypeSafe API:

   ```bash
   export JEV_BASE_URL=https://api.typesafe.ai/v1/systemone
   export JEV_MODEL=jev-latest
   export JEV_API_KEY=your_typesafe_key
   ```

   Or with OpenCode's Console endpoint and the same OpenCode key:

   ```bash
   export JEV_BASE_URL=https://opencode.ai/inference/systemone/v1/systemone
   export JEV_MODEL=jev-1.13-free  # optional
   # JEV_API_KEY defaults to OPENAI_API_KEY
   ```

   Without it, or when the model is unavailable, the DJ falls back to choosing actions with the conversation model.

6. **(Optional) radio voice**: give the DJ a voice in the voice channel with [ElevenLabs](https://elevenlabs.io/). Add a male Spanish (Argentina) voice from the [voice library](https://elevenlabs.io/voice-library) and copy its ID:

   ```bash
   export ELEVENLABS_API_KEY=your_api_key
   export ELEVENLABS_VOICE_ID=your_voice_id
   export ELEVENLABS_MODEL_ID=eleven_v4  # optional
   ```

   The line is written while the previous song plays and airs in the gap, so the music never plays underneath it. The first song after a reconnect, and the autoplay songs, are written on the spot. The provider checks its character quota every five minutes and skips lines when the period is exhausted, so the free tier never breaks playback. Lines are capped at 95 characters (one long line of up to 200 characters every fifth line), with audio tags (`[laughs]`, `[sighs]`, `[excited]`) for a performed delivery.

7. **(Optional) welcome audio**: put an MP3 at `assets/welcome.mp3`.

## Run

```bash
bun run start
# or, while developing
bun run dev
```

`bun run check` runs lint, typecheck and the test suite.

## Using it

1. **Point it at a channel** (the author needs Manage Channels):

   ```
   @DJ #music
   ```

2. **Play something**: join a voice channel and post a link or search term in the listening channel:

   ```
   never gonna give you up
   ```

3. **Control playback**: the buttons on the now-playing message cover everything, or ask in your own words:

   ```
   @DJ pausá
   @DJ seguí
   @DJ saltéala
   @DJ mostrame la cola
   @DJ sacá la 3
   ```

4. **Talk to the DJ**:

   ```
   @DJ poneme algo tranqui para el asado
   ```

5. **Set its personality** (Manage Server; ask in the listening channel):

   ```
   @DJ sé un dj cumbiero que no para de hacer chistes
   ```

## Testing

- `bun run test` runs the unit tests; `bun test` works too.
- `bun run typecheck` checks the TypeScript contracts.
- `bun run test:e2e` runs the live suite against a real guild. It reads the token and model variables from `~/.config/dj/discord.env` (override with `E2E_ENV_FILE`, `E2E_GUILD`, `E2E_VOICE`, `E2E_TEXT`) and needs the bot service stopped so two clients do not share the token.

## Layout

```
src/
  index.ts, app.ts       process entry and composition root
  config.ts              the only environment reader
  core/                  clock, errors, logger, async, text, TTL map
  ports/                 capability interfaces
  providers/             music, speech, language-model, classifier, settings
  dj/                    persona, prompts, conversation, replies, announcements
  on-air/                station state machine, script, host
  commands/              command specs, bus, fast router
  discord/               gateway, handlers, views, message slot
```
