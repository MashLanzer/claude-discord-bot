const { spawn } = require('child_process');

const p = spawn('cmd.exe', ['/c', 'c:/Users/Mash/claude-discord-bot/claude-free.bat', '--dangerously-skip-permissions'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', CI: '1' } // CI=1 often disables spinners in TUIs
});

p.stdout.on('data', d => console.log('OUT:', d.toString()));
p.stderr.on('data', d => console.error('ERR:', d.toString()));

setTimeout(() => {
    p.stdin.write('hello\n');
}, 5000);

setTimeout(() => {
    p.kill();
    process.exit(0);
}, 15000);
