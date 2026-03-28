const pty = require('node-pty');
const stripAnsi = require('strip-ansi');

const ptyProcess = pty.spawn('cmd.exe', ['/c', 'c:/Users/Mash/claude-discord-bot/claude-free.bat'], {
  name: 'xterm-color',
  cols: 80,
  rows: 30,
  cwd: process.cwd(),
  env: process.env
});

ptyProcess.on('data', function(data) {
  const clean = stripAnsi(data);
  process.stdout.write(clean);
});

setTimeout(() => {
  ptyProcess.write('hello\r');
}, 3000);

setTimeout(() => {
  process.exit();
}, 10000);
