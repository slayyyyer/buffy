import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const candidates = {
  win32: [
    'dist/win-unpacked/Buffy.exe',
  ],
  darwin: [
    'dist/mac-arm64/Buffy.app/Contents/MacOS/Buffy',
    'dist/mac/Buffy.app/Contents/MacOS/Buffy',
    'dist/mac-x64/Buffy.app/Contents/MacOS/Buffy',
  ],
  linux: [
    'dist/linux-unpacked/buffy',
    'dist/linux-unpacked/Buffy',
    'dist/linux-unpacked/buffy-desktop',
  ],
};

const binary = (candidates[process.platform] || []).map((item) => path.resolve(root, item)).find((item) => fs.existsSync(item));
if (!binary) {
  console.error(`smoke: could not find a packaged binary for ${process.platform}`);
  console.error(`smoke: looked for ${(candidates[process.platform] || []).join(', ') || 'no known paths'}`);
  process.exit(1);
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-smoke-'));
const port = String(45000 + Math.floor(Math.random() * 1000));
const env = {
  ...process.env,
  BUFFY_HOME: home,
  BUFFY_PORT: port,
  BUFFY_QUIET: '1',
};

console.log(`smoke: launching ${binary}`);
const child = spawn(binary, ['--smoke-test', '--no-sandbox'], {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: true,
});

let finished = false;
const timeout = setTimeout(() => {
  if (finished) return;
  finished = true;
  console.error('smoke: packaged app did not exit within 45 seconds');
  child.kill();
  fs.rmSync(home, { recursive: true, force: true });
  process.exit(1);
}, 45_000);
timeout.unref?.();

child.on('error', (error) => {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  console.error(`smoke: failed to launch packaged app: ${error.message}`);
  fs.rmSync(home, { recursive: true, force: true });
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  fs.rmSync(home, { recursive: true, force: true });
  if (signal) {
    console.error(`smoke: packaged app exited on ${signal}`);
    process.exit(1);
  }
  if (code !== 0) {
    console.error(`smoke: packaged app exited with code ${code}`);
    process.exit(code || 1);
  }
  console.log('smoke: packaged app started, rendered, and exited cleanly');
});
