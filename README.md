# tsu-ld/dj

Simple Discord bot that plays music in your voice channel.
Just drop a song name or link in the assigned text channel and it'll start playing.

## Features

- **Music Playback**: Plays YouTube and Spotify links/queries.
- **Skip**: Just type "skip" (while tagging the bot) to skip the current track.
- **Auto Config**: The bot remembers which text channel to listen to.
- **Welcome Audio**: Plays `assets/welcome.mp3` when first joining a guild's voice channel.

## Tech Stack

- **[Node.js](https://nodejs.org/)**: 22
- **Discord**: [discord.js](https://discord.js.org/) + [distube](https://distube.js.org/)
- **Plugins**: YouTube + Spotify
- **Multimedia**: [ffmpeg](https://ffmpeg.org/)

## Requirements

1. **FFmpeg**: Install [ffmpeg](https://ffmpeg.org/download.html) and make sure it's on your PATH.
2. **Discord Bot**: Create a [Discord bot](https://discord.com/developers/applications) and get its token.

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

2. **Configuration**:
   Copy `config.example.json` to `config.json` and add your setup:
   ```json
   {
     "DISCORD_TOKEN": "your_bot_token",
     ":...other_configurations}"
   }
   ```
   Check `src/messages/default-messages.js` for all available templates.

3. **Welcome Audio** (Optional):
   Place an MP3 file at `assets/welcome.mp3`. The bot will play this clip the first time it joins a voice channel in each session.

## Run

```bash
npm start
# or for development
npm run dev
```

I got tired of complicated music bots, so this one just... plays the damn song.
