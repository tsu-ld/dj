# 🎵 DJ

Simple Discord bot that plays music in your voice channel.
Just drop a song name or link in the assigned text channel and it'll start playing.
Type "skipea" to skip the current track.

## Tech Stack
- Node.js 22
- `discord.js` + `distube`
- YouTube + Spotify plugins
- `ffmpeg`

## Requirements
- Install [`ffmpeg`](https://github.com/BtbN/FFmpeg-Builds/releases/tag/latest) and make sure it’s on your PATH.
- Create a Discord bot and get its token.
- Choose the text channel the bot listens to and get its ID.

## Setup
Copy `.env.example` to `.env` and fill:
```env
DISCORD_TOKEN=your_bot_token
TEXT_CHANNEL_ID=the_text_channel_id
```

## Run
```bash
npm install
npm start
# or
npm run dev
```

I got tired of complicated music bots, so this one just... plays the damn song.
