# AGENTS.md

## Run Commands

- `npm start` - Production run (includes `--max-old-space-size=256` memory limit)
- `npm run dev` - Development with `--watch` flag for auto-reload
- `npm run lint` - Linting via antfu/eslint-config

## Requirements

- **Node.js 22** (required, per `package.json` engines)
- **FFmpeg** - Must be installed separately and on PATH (not an npm dependency)

## Configuration

- Copy `config.example.json` to `config.json` before running
- Bot token goes in `DISCORD_TOKEN`
- `assets/welcome.mp3` (optional) - Played when bot first joins a voice channel per guild

## Architecture

- Entry point: `src/index.js`
- Import aliases: `#client`, `#player`, `#features/*` (defined in `package.json` imports)
- Uses discord.js 14 + distube 5 for music playback
- Config is auto-persisted to `config.json` on changes
- No test suite in this repo
