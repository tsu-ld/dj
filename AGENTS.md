# AGENTS.md

## Run Commands

- `bun install` - Install dependencies (Bun is the package manager and script runner)
- `bun run start` - Production run
- `bun run dev` - Development with `--watch` flag for auto-reload
- `bun run lint` - Linting via antfu/eslint-config
- `bun test` - Run tests
- `bun run test:e2e` - Run the live e2e suite (`e2e-test.mjs`) against the real Discord guild; it reads the token and LLM vars from `~/.config/dj/discord.env` (override with `E2E_ENV_FILE`, `E2E_GUILD`, `E2E_VOICE`, `E2E_TEXT`), and needs the bot service stopped so two clients don't share the token

## Requirements

- **Node.js 24** (required, per `package.json` engines; the runtime is Node, not Bun - distube is incompatible with Bun)
- **FFmpeg** - Must be installed separately and on PATH (not an npm dependency)
- **yt-dlp** - Must be installed separately and on PATH (not an npm dependency)

## Configuration

- Bot token goes in the `DISCORD_TOKEN` environment variable
- The DJ's LLM runs on any OpenAI-compatible Responses API endpoint (`/responses`), set via `OPENAI_BASE_URL` (full endpoint URL) and `OPENAI_API_KEY`, with `OPENAI_MODEL` optional (defaults to `deepseek-v4-flash`). Without them, the DJ can't hold a conversation or act on requests (a ❌ reaction marks the failure), announcements go out as plain text instead of in character, and only the deterministic commands keep working
- Per-guild settings are auto-persisted to `data/guilds.json` (gitignored)
- Configure the listening channel by mentioning the bot and a channel: `@DJ #music`
- Configure the DJ's personality (Manage Server permission needed): `@DJ persona you are a cumbiero dj`
- `assets/welcome.mp3` (optional) - Played when bot first joins a voice channel per guild

## Runtime notes

- Node 24 runs plain JavaScript natively; there is no build step and no TypeScript.
- YouTube playback uses the `yt-dlp` binary directly (ytdl-core fails to decipher current YouTube player JS). Audio is downloaded to a file in `$TMPDIR/dj-audio` and played from there: YouTube's googlevideo audio URLs only answer closed-range requests, which ffmpeg cannot stream. The `player_client=android` extractor arg avoids YouTube's IP throttling (403s). Files older than a day are cleaned up.

## Architecture

- Entry point: `src/index.js`
- Uses discord.js 14 + distube 5 for music playback
- Plain JavaScript: relative imports carry the real on-disk `.js` extension (Node 24 ESM)
- Tests run with `bun test`
- The DJ layer lives in `src/dj/`: messages mentioning the bot are handled by the LLM through OpenCode Go's `/responses` endpoint, with tools to control the queue. Plain messages in the configured channel still search YouTube directly
