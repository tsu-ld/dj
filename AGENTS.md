# AGENTS.md

## Run Commands

- `bun install` - Install dependencies (Bun is the package manager and script runner)
- `bun run start` - Production run
- `bun run dev` - Development with `--watch` flag for auto-reload
- `bun run lint` - Linting via antfu/eslint-config
- `bun run test` - Run the unit tests (`bun test` works too; CI runs lint and tests)
- `bun run test:e2e` - Run the live e2e suite (`e2e-test.mjs`) against the real Discord guild; it reads the token and LLM vars from `~/.config/dj/discord.env` (override with `E2E_ENV_FILE`, `E2E_GUILD`, `E2E_VOICE`, `E2E_TEXT`), and needs the bot service stopped so two clients don't share the token

## Requirements

- **Node.js 24** (required, per `package.json` engines; the runtime is Node, not Bun - distube is incompatible with Bun)
- **FFmpeg** - Must be installed separately and on PATH (not an npm dependency)
- **yt-dlp** - Must be installed separately and on PATH (not an npm dependency)

## Configuration

- Bot token goes in the `DISCORD_TOKEN` environment variable
- The DJ's LLM runs on any OpenAI-compatible Responses API endpoint (`/responses`), set via `OPENAI_BASE_URL` (full endpoint URL) and `OPENAI_API_KEY`, with `OPENAI_MODEL` optional (defaults to `deepseek-v4-flash`). Without them, the DJ can't hold a conversation or act on requests (refusals reply with the plain reason), announcements go out as plain text instead of in character, and only the buttons, Jev-routed commands and plain messages in the listening channel keep working. Tagged song requests still need the LLM
- The fast action router is optional: set `JEV_BASE_URL` (official TypeSafe: `https://api.typesafe.ai/v1/systemone` with `JEV_MODEL=jev-latest` and `JEV_API_KEY`; OpenCode Console: `https://opencode.ai/inference/systemone/v1/systemone` with `JEV_MODEL=jev-1.13-free` and the OpenCode key). Without it, or when the model is unavailable, the DJ's LLM chooses from the same action registry. OpenCode Go's model list does not include Jev today; the Console System One endpoint needs free quota or credits
- Spotify links use the `@distube/spotify` scrape fallback by default; set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` (both) to use the official API instead
- The radio voice is optional: `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` (male Argentine voice from the ElevenLabs library) make the bot say the song intro in the gap before a song starts. `getStreamURL` awaits a `setBeforeStream` hook, so the line always finishes before the audio starts and never plays over the music. One song in three runs without a line, and an autoplay song only speaks when it lands on that slot. `ELEVENLABS_MODEL_ID` defaults to `eleven_v4`. The LLM writes the lines with audio tags (`[laughs]`, `[sighs]`, `[excited]`) for a performed delivery. Lines are capped at 95 characters (200 every fifth line) and skipped when the subscription quota is used up; without the variables, only music plays
- Per-guild settings are auto-persisted to `data/guilds.json` (gitignored); a corrupt or wrong-shape file is moved to `guilds.json.corrupt-<timestamp>` and the bot starts with an empty store
- Configure the listening channel by mentioning the bot and a channel: `@DJ #music`
- Configure the DJ's personality in plain language in the listening channel (Manage Server permission needed): `@DJ sé un dj cumbiero`
- `assets/welcome.mp3` (optional) - Played when bot first joins a voice channel per guild

## Runtime notes

- Media limits: 50 songs per playlist link, 200 songs per queue, 512 MiB of cached audio, 200 MiB per downloaded file. Live streams are rejected.
- Node 24 runs plain JavaScript natively; there is no build step and no TypeScript.
- YouTube playback uses the `yt-dlp` binary directly (ytdl-core fails to decipher current YouTube player JS). A single video or a search remembers the muxed progressive url from the metadata call and starts streaming from it in under a second (audio-only urls answer 403 to ffmpeg, so they fall back to a download); a flat playlist entry resolves that url at play time. The next track is prefetched to `$TMPDIR/dj-audio` while the current one plays, one at a time per server, so most songs after the first read from disk; Spotify songs are skipped because they resolve to YouTube later. Files older than a day are cleaned up.

## Architecture

- Entry point: `src/index.js`
- Uses discord.js 14 + distube 5 for music playback
- Plain JavaScript: relative imports carry the real on-disk `.js` extension (Node 24 ESM)
- Tests run with `bun run test` (`bun test` works too)
- Music modules keep one concern each: `src/music/voice.js` owns the voice-channel permission checks used before joining, `src/music/yt-dlp-policy.js` owns the URL allowlist applied by `src/music/yt-dlp-plugin.js`, and `src/music/player.js` only wires plugins and DisTube options
- Every user-triggerable action lives in `src/actions/`, one file each, with its model schema, router metadata and handler. `src/actions/index.js` is the only registry: Jev, the LLM tools and the now-playing buttons all dispatch through it, so adding an action is one file plus one import
- The DJ layer lives in `src/dj/`: messages mentioning the bot are routed by Jev when `JEV_BASE_URL` is set, and by the LLM's tool choice through OpenCode Go's `/responses` endpoint otherwise; both paths use the same action registry. Plain messages in the configured channel still search YouTube directly
