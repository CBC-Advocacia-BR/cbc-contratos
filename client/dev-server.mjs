import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
process.chdir(__dirname);

const child = spawn(process.execPath, [
  join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js'),
  '--port', '5173'
], {
  cwd: __dirname,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code));
