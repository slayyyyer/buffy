import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appSourceSwitches,
  configSourceLocks,
  readConfig,
  resolveSourceEnabled,
  VERSION,
} from '../src/config.js';
import { startDaemon } from '../src/daemon.js';

test('VERSION is sourced from package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
  assert.match(VERSION, /^\d+\.\d+\.\d+(?:[-+].*)?$/);
});

test('config.json switching a source off is final', () => {
  assert.equal(
    resolveSourceEnabled({ section: { enabled: false }, prefEnabled: true }),
    false,
    'a hand-edited off must not be undone by the Settings toggle',
  );
  assert.equal(resolveSourceEnabled({ section: { enabled: false }, prefEnabled: false }), false);
});

test('otherwise the settings switch decides', () => {
  assert.equal(resolveSourceEnabled({ section: { enabled: true }, prefEnabled: false }), false);
  assert.equal(resolveSourceEnabled({ section: { enabled: true }, prefEnabled: true }), true);
  assert.equal(resolveSourceEnabled({ section: {}, prefEnabled: false }), false);
  assert.equal(resolveSourceEnabled({ section: {}, prefEnabled: true }), true);
  assert.equal(resolveSourceEnabled({}), true, 'defaults to on');
});

test('a smoke test forces every source off', () => {
  assert.equal(resolveSourceEnabled({ section: { enabled: true }, prefEnabled: true, forceOff: true }), false);
});

test('the app starts a source config.json switched off as off, even with the toggle on', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-config-'));
  const env = { ...process.env, BUFFY_HOME: home };
  delete env.BUFFY_PORT;
  let daemon = null;
  try {
    fs.writeFileSync(
      path.join(home, 'config.json'),
      `${JSON.stringify({ freebuff: { enabled: false } })}\n`,
    );
    const base = readConfig(env);
    const prefs = {
      connection: { freebuffWatcher: true, freebuffDatabase: true, claudeTranscript: true },
    };

    const switches = appSourceSwitches(base, prefs);
    assert.deepEqual(switches, { watch: true, freebuff: false, claudeTranscript: true });

    // The same switches the app hands its daemon must show up in health.
    daemon = await startDaemon({
      config: {
        ...base,
        port: 0,
        watch: { ...base.watch, enabled: switches.watch },
        freebuff: { ...base.freebuff, enabled: switches.freebuff },
        claudeTranscript: { ...base.claudeTranscript, enabled: switches.claudeTranscript },
      },
      env,
      quiet: true,
    });
    const health = await (await fetch(`http://127.0.0.1:${daemon.port}/health`)).json();
    assert.equal(health.adapters.freebuff.enabled, false);
    assert.equal(health.adapters.freebuff.reason, 'disabled');
    assert.equal(health.adapters.claudeTranscript.enabled, true);
  } finally {
    await daemon?.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the settings toggle decides when config.json is silent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-config-'));
  try {
    const base = readConfig({ ...process.env, BUFFY_HOME: home });
    assert.equal(appSourceSwitches(base, { connection: { freebuffDatabase: false } }).freebuff, false);
    assert.equal(appSourceSwitches(base, {}).freebuff, true);
    assert.equal(appSourceSwitches(base, {}, { forceOff: true }).freebuff, false, 'smoke never reads agent data');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('only the source config.json switched off is locked in settings', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-config-'));
  const env = { ...process.env, BUFFY_HOME: home };
  try {
    fs.writeFileSync(
      path.join(home, 'config.json'),
      `${JSON.stringify({ freebuff: { enabled: false }, watch: { enabled: false } })}\n`,
    );
    const locks = configSourceLocks(readConfig(env));
    assert.deepEqual(locks, {
      freebuffWatcher: { locked: true },
      freebuffDatabase: { locked: true },
      claudeTranscript: { locked: false },
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('the file and the resolver agree about an explicit off', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-config-'));
  const env = { ...process.env, BUFFY_HOME: home };
  try {
    fs.writeFileSync(
      path.join(home, 'config.json'),
      `${JSON.stringify({ freebuff: { enabled: false }, claudeTranscript: { enabled: false } })}\n`,
    );
    const config = readConfig(env);
    assert.equal(resolveSourceEnabled({ section: config.freebuff, prefEnabled: true }), false);
    assert.equal(resolveSourceEnabled({ section: config.claudeTranscript, prefEnabled: true }), false);
    assert.equal(resolveSourceEnabled({ section: config.watch, prefEnabled: true }), true, 'unset stays on');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
