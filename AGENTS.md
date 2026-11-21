# AGENTS.md

A Discord radio host in Bun + TypeScript. Read [VISION.md](VISION.md) before changing behavior: every change serves one of its tenets.

## Commands

- `bun install`: dependencies. Bun 1.4.5+ runs and type-checks TypeScript directly; there is no build step.
- `bun check`: the one gate. Its script formats, applies safe lint fixes, reports what is left and type-checks. CI runs `bun check && git diff --exit-code` and `bun test`; both must pass before every commit.
- `bun test <path>`: one area's tests.
- `bun run dev`: run with `--watch`. `bun run start`: production.
- `bun run test:e2e`: the live suite against a real guild. It reads `~/.config/dj/discord.env` (override with `E2E_ENV_FILE`, `E2E_GUILD`, `E2E_VOICE`, `E2E_TEXT`). Stop the bot service first, and ask before running it: it logs into a real account.
- FFmpeg and yt-dlp must be on `PATH`. Only `src/config.ts` reads the environment.

## Map

```
src/
  index.ts, app.ts   process entry; the only composition root
  config.ts          environment -> validated AppConfig
  limits.ts          product limits and on-air cadence (queue, playlist, line length)
  messages.ts        the bot's fixed replies
  core/              clock, errors, logger, async, cooldown, text, TTL map, JSON guards
  ports/             the capabilities features may use
  providers/         adapters behind the ports; the only place a technology is named
  commands/          command specs and the one bus that runs them
  discord/           gateway, message and button handlers, the cards
  dj/                persona, prompts, conversation, in-character replies
  on-air/            station, angle, script, line writer, host
```

## Words we use

Name things with these words, in code, tests and logs:

- **listening channel**: the one text channel where the bot reads every message.
- **router**: the fast classifier that maps a message to a command, a search or the DJ.
- **DJ**: the conversational model that answers and acts through command tools.
- **command spec / bus**: a command's contract (preconditions, authorization, run, confirm) and the single executor every entry point uses.
- **chatter / refusal**: `ui.reply` (silenced to ✅ while in voice) vs `ui.error` (always text).
- **station**: per-server cadence and memory: which slot speaks, which line is long, the recent run.
- **run**: what the room just heard, who asked, and what comes next.
- **angle**: the one idea a line is about (welcome, listener, anniversary, story, news, fact, run).
- **line**: one spoken sentence or two. A **prepared clip** is a line rendered ahead of its song.
- **host**: plays the right line in the gap before a song, never over it.
- **card**: the now-playing or queue message. The **slot** owns the cards of one channel.
- **own pick**: a song the radio chose because nobody asked. The host never credits "the radio".

## How we write code

These are rules for every change. Where older code falls short, fix it when you touch it.

**Readable like a book.**

- A name says what the thing is or does in this product, not how it works or which library it uses.
- A function reads top to bottom at one level of detail.
- Names and tests say everything. The one comment is a workaround forced by an outside defect, as `WORKAROUND(<issue url>): <what it disables and when it can go>`.
- No `utils`, `helpers`, `misc`, `v2` or `new`.

**Least code that works.**

- Reuse before adding. One owner for each rule, constant and sentence.
- No option, parameter, export or interface that only one caller or only a test uses: code that only its own tests use is dead.
- Delete freely. Version control remembers.

**Performance is a feature of the show.**

- Never block the event loop. Stream audio, never buffer it.
- Do slow work behind the current song: the next download, the next line, the next facts.
- Every external call has a timeout. Retries are bounded and never retry a cancelled request.
- Every map is bounded (TTL map or a cap from `limits.ts`). Mutations of one server's queue run in order through the keyed queue.

**Types.**

- Explicit at ports and exported signatures; inferred inside.
- No `any`, no `!`, no `as` outside a boundary that validated the value, no enums. External JSON is `unknown` until a guard says otherwise.

**Errors.**

- `UserError` is safe to show. `ProviderError` carries retryable, fatal or quota, and the HTTP status. Anything else is logged and answered with a generic message.
- Each failure is caught and logged at one layer. Never swallow an error silently, and never log it and then rethrow it.
- A broken speech, model or fact provider skips the line and keeps the music playing.

**State and lifecycle.**

- No module-level mutable state. The object that owns a timer, file, child process or cache exposes `dispose` or `flush`, and `app.ts` calls it on shutdown.

## Rules the tests enforce

`src/tests/architecture.test.ts` fails on any of these:

- a cycle;
- a missing import;
- an upward import (`app -> commands/discord/dj/on-air -> ports -> core`; providers never import features);
- a technology name in a file path;
- an environment read outside `config.ts`;
- a non-test source file over 300 lines.

`bun check` fails on a `console` call anywhere but `e2e-test.ts`, and on a comment that is not a `WORKAROUND`.

## Behavior that must not regress

- `beforeStream` is awaited before the audio URL is returned, so a line never plays over a song.
- Untrusted titles, names and headlines reach the DJ's and the host's prompts only inside a `dataBlock`. The persona is the server's own instruction, capped at 500 characters.
- Every command is authorized against the member who asked, before any side effect.
- A prepared clip belongs to one song: a clip whose song or run changed is never played, and disconnect and reset delete it.
- Product limits live in `limits.ts` (50 songs per playlist, 200 in the queue); the 512 MiB audio cache is in `config.ts`. Live streams are rejected, and links are checked against an allowlist before the extractor runs.

## Tests

- Pure rules (station, angle, script, prompts, queue, text, policy) are tested without mocks.
- Providers use fake HTTP, a fake extractor binary and fake audio players; no network.
- Handlers use fake messages, channels and interactions. Shared builders live in `src/tests/fixtures.ts`. A fake of a discord.js or engine class is partial and cast to the class, so the two type-assertion lint rules are off under `tests/`; they stay on everywhere else.
- A test asserts what a listener would notice. Write it first and watch it fail for the reason it names.
