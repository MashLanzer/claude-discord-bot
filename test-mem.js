const { execSync } = require('child_process');
try {
  console.log(execSync('c:/Users/Mash/claude-discord-bot/claude-free.bat -p "Remember the word BLARGH"', {stdio: 'inherit'}));
  console.log(execSync('c:/Users/Mash/claude-discord-bot/claude-free.bat -p "What was the word I just told you to remember?"').toString());
} catch(e) {
  console.error(e.message);
}
