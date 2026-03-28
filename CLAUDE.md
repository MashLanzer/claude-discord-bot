# Claude Discord Bot Project

This project implements a Discord bot that connects to the Claude Code CLI directly from the bot's direct messages. The bot allows users to type `!claude <prompt>` in a DM with the bot and receive responses from Claude Code.

## 📋 Project Overview

- **Purpose**: Enable direct Claude Code interactions within Discord DM channels
- **Tech Stack**: Node.js, discord.js, Claude Code CLI
- **Core Functionality**:
  - Receive user prompts via Discord DM
  - Execute Claude Code CLI with the prompt
  - Return formatted responses to the user
  - Handle long responses by splitting into multiple messages

## 🚀 Setup Instructions

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Claude Code CLI:
   - Download from https://claude.com/claude-code
   - Ensure `claude` command is available in PATH

3. Configure environment variables:
   ```bash
   # Create .env file
   echo "DISCORD_TOKEN=your_discord_bot_token" >> .env
   echo "CLIPATH=c:\\Users\\Mash\\claude-code\\launcher.bat" >> .env
   ```

4. Build the bot:
   ```bash
   node discord-bot.js
   ```

## 📐 Bot Functionality

### Message Flow
1. User sends `!claude <prompt>` in a DM
2. Bot extracts the prompt and executes Claude CLI
3. Response is split into Discord-friendly chunks and sent back

### Command Structure
- **Primary Command**: `!claude` - Execute Claude Code with user prompt
- **Initialization Command**: `/init` - Register this bot instance and show setup info

## 🔧 Technical Details

### File Structure
```
claude-discord-bot/
├── CLAUDE.md                 # Project documentation
├── discord-bot.js            # Main bot implementation
├── .env                      # Environment configuration
├── package.json              # Dependencies
└── node_modules/             # Node modules
```

### Key Components
- **Discord Client**: discord.js v14 for slash command handling
- **CLI Execution**: Child processes to run Claude Code
- **Response Formatting**: Chunk splitting for Discord message limits

## ⚙️ Usage

### User Commands
- DM the bot and type: `!claude <your question>`
- Use `/init` to see initialization information

### Bot Response
The bot will:
- Execute Claude Code with the provided prompt
- Return the response in formatted chunks
- Include the original prompt at the end of the response

iniciar y correr bot en segundo plano 
node bot.js
pm2 start bot.js --name "claude-bot"
