# discord-bot

## Prerequisites
- Node.js 22 LTS or newer (`node -v` should show `v22.x`)
- `ffmpeg` available on PATH

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file (or copy `.env.example`) with:
   ```env
   DISCORD_TOKEN=your_bot_token_here
   TEXT_CHANNEL_ID=the_text_channel_id_for_commands
   ```

## Run
```bash
npm start
```

This uses Node’s `--env-file` to load variables from `.env` and starts the bot.
