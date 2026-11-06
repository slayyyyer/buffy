import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PACKAGE = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const VERSION = PACKAGE.version;
export const DEFAULT_PORT = 4517;

/** The six states the pet can be in. Everything else is mapped onto these. */
export const STATES = ['idle', 'thinking', 'working', 'needs-you', 'done', 'error'];

export function buffyDir(env = process.env) {
  return env.BUFFY_HOME ? path.resolve(env.BUFFY_HOME) : path.join(os.homedir(), '.buffy');
}

export function buffyFile(name, env = process.env) {
  return path.join(buffyDir(env), name);
}

export function ensureBuffyDir(env = process.env) {
  const dir = buffyDir(env);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const BUILTIN = {
  port: DEFAULT_PORT,
  doneHoldMs: 4000,
  watch: {
    enabled: true,
    directory: null,
    quietMs: 2500,
    pollMs: 700,
    ignore: [
      'node_modules',
      '.git',
      'dist',
      'build',
      'out',
      '.next',
      '.turbo',
      '.cache',
      'target',
      'coverage',
      'artifacts',
      '.buffy',
      '*.buffy-backup-*',
    ],
  },
  hatch: {
    provider: 'openai',
    model: 'gpt-image-1',
    size: '1024x1024',
    quality: 'medium',
    baseUrl: 'https://api.openai.com/v1',
  },
};

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function readConfig(env = process.env) {
  ensureBuffyDir(env);
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(buffyFile('config.json', env), 'utf8'));
  } catch {
    /* missing or malformed config falls back to defaults */
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};

  const watch = raw.watch && typeof raw.watch === 'object' && !Array.isArray(raw.watch) ? raw.watch : {};
  return {
    ...BUILTIN,
    ...raw,
    port: clampNumber(env.BUFFY_PORT ?? raw.port, BUILTIN.port, 0, 65535),
    doneHoldMs: clampNumber(raw.doneHoldMs, BUILTIN.doneHoldMs, 250, 120_000),
    watch: {
      ...BUILTIN.watch,
      ...watch,
      enabled: watch.enabled !== false,
      quietMs: clampNumber(watch.quietMs, BUILTIN.watch.quietMs, 250, 120_000),
      pollMs: clampNumber(watch.pollMs, BUILTIN.watch.pollMs, 100, 60_000),
      ignore: Array.isArray(watch.ignore) ? watch.ignore : BUILTIN.watch.ignore,
    },
    hatch: { ...BUILTIN.hatch, ...(raw.hatch || {}) },
  };
}

/** Merge a patch into ~/.buffy/config.json, preserving unknown keys. */
export function writeConfig(patch, env = process.env) {
  const current = readConfig(env);
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(buffyFile('config.json', env), 'utf8'));
  } catch {
    /* start from an empty file */
  }
  const next = {
    ...raw,
    ...patch,
    watch: { ...current.watch, ...(patch.watch || {}) },
    hatch: { ...current.hatch, ...(patch.hatch || {}) },
  };
  ensureBuffyDir(env);
  fs.writeFileSync(buffyFile('config.json', env), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
