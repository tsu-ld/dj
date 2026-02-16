# dot-tsu/dj

Simple Discord bot that plays music in your voice channel.
Just drop a song name or link in the assigned text channel and it'll start playing.

## Features

- **Music Playback**: Plays YouTube and Spotify links/queries.
- **Skip**: Just type "skip" (while tagging the bot) to skip the current track.
- **Auto Config**: The bot remembers which text channel to listen to.
- **Welcome Audio**: Plays `assets/welcome.mp3` when first joining a guild's voice channel.

## Usage

1. **Configure Channel**: Mention the bot and a channel to set where it listens for music commands.
   ```
   @DJ #music-stuff
   ```
   The bot will remember this channel even after restarting.

2. **Play Music**: Join a voice channel and send a link or search term in the configured text channel.
   ```
   never gonna give you up
   ```

3. **Skip**:
   ```
   @DJ skip
   ```

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Variables**:
   Copy `.env.example` to `.env` and fill:
   ```env
   DISCORD_TOKEN=your_bot_token
   ```

3. **Welcome Audio** (Optional):
   Place an MP3 file at `assets/welcome.mp3`. The bot will play this clip the first time it joins a voice channel in each session.

## Run

```bash
npm start
# or for development
npm run dev
```

I got tired of complicated music bots, so this one just... plays the damn song.
