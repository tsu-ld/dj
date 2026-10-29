# AGENTS.md

## Run Commands

- `bun install` — install dependencies (Bun is the package manager and script runner)
- `bun run start` — production run (`node src/index.ts`, no build step)
- `bun run dev` — development with `--watch`
- `bun run check` — lint + typecheck + tests (CI runs this)
- `bun run lint` — ESLint
- `bun run typecheck` — `tsc --noEmit`
- `bun run test` — unit tests (`bun test` works too)
- `bun run test:e2e` — live suite against the real Discord guild; it reads the token and model variables from `~/.config/dj/discord.env` (override with `E2E_ENV_FILE`, `E2E_GUILD`, `E2E_VOICE`, `E2E_TEXT`) and needs the bot service stopped so two clients do not share the token

## Requirements

- **Node.js 24** (required per `package.json`; it strips TypeScript types natively, so there is no build step)
- **FFmpeg** on `PATH` (the voice engine streams audio through it)
- **yt-dlp** on `PATH` (the music provider resolves and downloads YouTube audio through it)

## Configuration

- `DISCORD_TOKEN` is required.
- The DJ's conversation uses any OpenAI-compatible Responses API endpoint: `OPENAI_BASE_URL` (full `/responses` URL), `OPENAI_API_KEY`, optional `OPENAI_MODEL` (default `deepseek-v4-flash`). Without it the bot still plays music; announcements go out as plain text and tagged song requests are unavailable.
- The optional fast router uses a System One endpoint: `JEV_BASE_URL`, `JEV_API_KEY` (falls back to `OPENAI_API_KEY`), optional `JEV_MODEL` (default `jev-1.13-free`). Without it, the model chooses from the same command registry.
- Spotify links use the scrape fallback; set `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` (both) for the official API.
- The optional radio voice uses `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, optional `ELEVENLABS_MODEL_ID` (default `eleven_v4`). Without all required values the bot only plays music.
- `LOG_LEVEL` (`debug|info|warn|error`) and `EXTRACTOR_COMMAND` are optional. Per-guild settings live in `data/guilds.json` (gitignored, versioned, atomic writes, legacy files migrated, corrupt files quarantined).

## Architecture

```
src/
  index.ts          process entry: config, app, signals
  app.ts            the only composition root
  config.ts         env -> validated AppConfig (the only env reader)
  core/             clock, errors, logger, async primitives, text, TTL map, JSON guards
  ports/            MusicPort, SpeechPort, ConversationPort, DecisionPort, SettingsPort, RepliesPort
  providers/        adapters; the only place a technology is named
    music/          engine, catalogue, extractor, cache, stream, policy, welcome
    speech/         voice synthesis + quota
    language-model/ conversation wire format
    classifier/     fast typed decision
    settings/       versioned JSON store
  dj/               persona, prompts, conversation loop, replies, announcements
  on-air/           station state machine, script, host
  commands/         command specs, bus, fast router
  discord/          gateway, message/interaction handlers, views, message slot
  tests/            architecture contract
```

- `app.ts` builds every capability as a plain object (`musicEngine`, `speechSynthesizer`, `conversationModel`, `intentClassifier`, `settingsStore`) and wires the events. Nothing else constructs a provider.
- **Dependency rule:** `app -> commands/discord/dj/on-air -> ports -> core`; providers sit behind ports and import only `core`, `ports` and their own SDK. Providers never import `commands`, `discord`, `dj` or `on-air`. `src/tests/architecture.test.ts` enforces this.
- **No technology names outside `src/providers/`.** A module is named for what it does (`music`, `speech`, `language-model`, `classifier`), never for the library behind it.
- **Commands:** one `CommandBus` executes the fast router, the model's tool calls and the buttons. Preconditions, member authorization, confirmation, ack and error mapping live once.
- **State:** no module-level mutable request state. The message slot owns its card ids/timers, the station owns cadence and prepared clips, the conversation owns its bounded history, the speech provider owns its quota cache. Every long-lived object exposes `dispose`/`flush`.
- **Lifecycle:** shutdown aborts in-flight work, flushes settings, leaves voice, kills extractor children and destroys the client with a timeout. Unhandled rejections stop the process cleanly with a non-zero exit.
- **Errors:** `UserError` is safe to show, `ProviderError` carries a capability and a retryable/fatal/quota kind, and unknown errors are logged and answered with a generic message. Providers map their wire errors once.
- **Types:** explicit at ports and exported signatures, inference inside. No `any`, no non-null assertions, no casts outside a runtime-validated boundary. No enums.

## Behavior Invariants

- The stream waits for the on-air line: `beforeStream` is awaited before the audio URL is returned, so a spoken line never plays over the music.
- A prepared line belongs to one song; skip, removal, disconnect and reset delete it. One requested song in three is silent; autoplay speaks one in three; every fifth line is long. Cadence survives a disconnect and resets on a manual clear.
- TTS, quota and model failures skip the line; they never break playback.
- The conversation has a deadline, tool-round/call caps and a final tool-free answer; history is trimmed to whole exchanges.
- Every command is authorized against the invoking member before any side effect.
- Untrusted titles, names and persona text only appear inside a `dataBlock`; they can never close the block or become instructions.
- Music limits: 50 songs per playlist, 200 in the queue, 512 MiB cache, 200 MiB per download, live streams rejected, URL allowlist before the extractor.
- A failed song or an empty voice channel leaves the connection cleanly; the now-playing and queue cards are deleted with the session.

## Testing

- Pure rules (station, prompts, queue, text, policy) are tested without mocks.
- Providers have contract tests with fake HTTP, a fake extractor binary and fake audio players; no network.
- Handlers are tested with fake messages/channels and a fake `CommandBus`.
- `src/tests/architecture.test.ts` fails on a cycle, a missing import, an upward dependency, a leaked technology name, a `process.env` read outside `config.ts`, a `console` call, or a source file over 300 lines.
- The e2e suite is event/status based (playback duration, queue size, voice state), uses a temporary settings file and is run manually while the service is stopped.
