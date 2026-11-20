import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import { decode, encode, compare } from './helpers/png.js';
import { defaultPrefs } from '../src/prefs.js';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const GOLDEN_ROOT = path.join(ROOT, 'test', 'goldens', process.platform);
const UPDATE = process.env.UPDATE_GOLDENS === '1';
const PORT = '45177';

// Both cases are framed by the character system, not by the layout: the compact
// window is 234x300 CSS px at every size, and the picker thumbnail is a 150x64
// canvas. A regression in either shows up as pixels moving, so a golden recorded
// from the frozen fixture is enough to catch it.
const CASES = [
  { name: 'compact', mode: 'compact', width: 234, height: 300 },
  { name: 'settings-thumb', mode: 'settings-thumb' },
];

// Measured on these two captures: ±20 per channel of noise moves no blocks, a
// one-pixel shift moves 29% of the compact blocks and 41% of the thumbnail's,
// and both recorded regressions move ~48%. Antialiasing on another runner is
// noise, so the CI budget sits far below anything a framing change does.
const MAX_BLOCK_RATIO = process.env.CI ? 0.15 : 0.03;

// Everything here has to be stable across runs: no daemon, no clock, no motion.
async function seedHome(home) {
  await fs.mkdir(home, { recursive: true });
  const prefs = defaultPrefs();
  prefs.characters.buffy.look = {
    outfit: 'dress',
    theme: 'plum',
    bow: 'pink',
    hat: 'sunhat',
    glasses: 'round',
    wand: 'none',
  };
  prefs.personality = {
    ...prefs.personality,
    reducedMotion: true,
    sleepy: false,
    idleHobbies: false,
    extraIdleGestures: false,
    returnGreetings: false,
    thoughtBubbles: 'off',
  };
  await fs.writeFile(path.join(home, 'preferences.json'), JSON.stringify(prefs, null, 2));
  await fs.writeFile(path.join(home, 'window.json'), JSON.stringify({ scale: 1 }, null, 2));
}

async function shoot(name, mode) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `buffy-golden-${name}-`));
  const home = path.join(workspace, 'home');
  const shot = path.join(workspace, `${name}.png`);
  try {
    await seedHome(home);
    await promisify(execFile)(
      electronPath,
      [
        ROOT,
        `--user-data-dir=${path.join(workspace, 'profile')}`,
        '--shot',
        shot,
        '--shot-mode',
        mode,
        '--shot-fixture',
        '--shot-exit',
      ],
      {
        env: { ...process.env, BUFFY_HOME: home, BUFFY_PORT: PORT },
        timeout: 60_000,
        windowsHide: true,
      },
    );
    return await fs.readFile(shot);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

test('golden shots keep the compact frame and the picker thumbnail in place', async (t) => {
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    return t.skip('Electron needs a display; golden shots are recorded on a desktop.');
  }

  for (const item of CASES) {
    await t.test(item.name, async (t) => {
      const goldenPath = path.join(GOLDEN_ROOT, `${item.name}.png`);
      const recorded = await fs.readFile(goldenPath).catch(() => null);
      if (!recorded && !UPDATE) {
        return t.skip(`no ${process.platform} golden yet — record one with UPDATE_GOLDENS=1 npm run test:shots`);
      }

      const actual = await shoot(item.name, item.mode);
      const image = decode(actual);
      if (item.width) {
        assert.equal(image.width, item.width, `${item.name} is ${image.width}px wide, expected ${item.width}`);
        assert.equal(image.height, item.height, `${item.name} is ${image.height}px tall, expected ${item.height}`);
      }

      if (!recorded) {
        await fs.mkdir(GOLDEN_ROOT, { recursive: true });
        await fs.writeFile(goldenPath, actual);
        return;
      }

      const golden = decode(recorded);
      assert.deepEqual(
        { width: image.width, height: image.height },
        { width: golden.width, height: golden.height },
        `${item.name} capture changed size (${image.width}x${image.height} vs ${golden.width}x${golden.height})`,
      );

      const result = compare(golden, image);
      const detail =
        `${result.blockDiffering} of ${result.blockTotal} blocks differ (${(result.blockRatio * 100).toFixed(2)}%), ` +
        `${result.differing} pixels, largest channel delta ${result.worst}`;
      if (result.blockRatio > MAX_BLOCK_RATIO) {
        const artifact = path.join(os.tmpdir(), `buffy-golden-${item.name}-diff.png`);
        await fs.writeFile(artifact, encode(result.mask));
        assert.fail(
          `${item.name} no longer matches its golden: ${detail}. ` +
            `Diff written to ${artifact}. Re-record with UPDATE_GOLDENS=1 npm run test:shots if the change is intended.`,
        );
      }
    });
  }
});
