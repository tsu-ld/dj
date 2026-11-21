# Vision

**dj is a radio host that lives in your Discord server.** Friends put on music the way they would on a game night: they say what they want, out loud, in their own words. The host plays it, talks between songs like someone who loves being on air, and keeps the night going when nobody is asking.

Other music bots are jukeboxes with a command line. This one is meant to feel like a person running the station.

## The problem

Music bots make people learn their syntax (`/play`, `/skip`, `/queue`), fill the chat with "Added to queue" spam, go silent or repeat themselves when the queue runs dry, and never say a word about what is playing. The room ends up serving the bot.

## Tenets

These are ordered: when two pull in different directions, the higher one wins. Each one has a reasonable opposite that we chose against.

1. **The music comes first.** The host never talks over a song. A spoken line waits in the gap, or it is dropped. A broken voice, model or fact source skips the line, never the song. _(Opposite we reject: a richer show that sometimes stutters.)_
2. **Talk like people talk.** No commands to learn. "skip this one", "play something chill" and a link all work in the listening channel. _(Opposite: precise, discoverable slash commands.)_
3. **Say less, mean it.** One song in three plays with no line at all. Every line has one idea. While the bot is in voice it reacts with ✅ instead of writing. _(Opposite: a chatty host that always fills the silence.)_
4. **Only true things on air.** Facts come from checked sources, never from the model's memory. If it cannot be checked, the host talks about the run instead: who asked, what just played, what comes next. _(Opposite: colorful trivia that is sometimes made up.)_
5. **The host is the radio.** Its picks are its own. It knows the room: who asked for what, their favorite songs, who skipped the last one. That is context for what to say, not something to announce. _(Opposite: neutral narration that credits "the algorithm".)_
6. **Small, readable, sturdy.** One process, plain objects, bounded memory, every limit written down. A newcomer reads the code like a book. _(Opposite: a plugin platform that can do anything.)_

## Non-goals

- Slash commands, dashboards, web panels or per-user settings beyond the server persona.
- Playing in many voice channels of one server at once, or being a general-purpose bot (moderation, games, levels).
- Sources beyond YouTube and Spotify links, live streams, or lyrics.
- A host that improvises facts, reads chat aloud, or talks over the music.
- Growth features: votes, premium tiers, leaderboards.

## What good looks like

- Someone new to the server plays a song in their first message without reading anything.
- An evening can run for hours on radio without a repeat and without a single chat message from the bot that nobody asked for.
- Any line the host says can be traced to the queue, the room's history or a checked fact.

When a change is proposed, ask which tenet it serves. If the honest answer is "none", it does not belong here.
