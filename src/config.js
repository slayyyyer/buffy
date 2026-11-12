import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PACKAGE = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const VERSION = PACKAGE.version;
export const DEFAULT_PORT = 4517;
export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;

/** The six states the companion can be in. Everything else is mapped onto these. */
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
  doneHoldMs: 30000,
  sessionTtlMs: DEFAULT_SESSION_TTL_MS,
  // A working session with no new event for this long is shown as quiet, not
  // as live activity. It stays in the session list; only its presentation
  // settles. This is deliberately far below sessionTtlMs.
  livenessMs: 90000,
  freebuff: {
    // Read Freebuff Desktop's own session database, read-only, to fill the
    // gaps between the AGENTS.md checkpoints.
    enabled: true,
    pollMs: 1000,
    // While nothing is running the adapter only stats the project files and
    // opens no database, so it can afford to check less often.
    idlePollMs: 5000,
    staleMs: 120000,
    maxProjects: 4,
    explicitGraceMs: 120000,
  },
  claudeTranscript: {
    // Zero-config fallback: tail ~/.claude transcripts while the hook is quiet.
    enabled: true,
    pollMs: 1500,
    activeMs: 900000,
    stuckMs: 600000,
    doneWindowMs: 60000,
    explicitGraceMs: 120000,
  },
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
  const freebuff = raw.freebuff && typeof raw.freebuff === 'object' && !Array.isArray(raw.freebuff) ? raw.freebuff : {};
  const claudeTranscript =
    raw.claudeTranscript && typeof raw.claudeTranscript === 'object' && !Array.isArray(raw.claudeTranscript)
      ? raw.claudeTranscript
      : {};
  return {
    ...BUILTIN,
    ...raw,
    port: clampNumber(env.BUFFY_PORT ?? raw.port, BUILTIN.port, 0, 65535),
    doneHoldMs: clampNumber(raw.doneHoldMs, BUILTIN.doneHoldMs, 250, 120_000),
    sessionTtlMs: clampNumber(raw.sessionTtlMs, BUILTIN.sessionTtlMs, 60_000, 86_400_000),
    livenessMs: clampNumber(raw.livenessMs, BUILTIN.livenessMs, 5_000, 1_800_000),
    freebuff: {
      ...BUILTIN.freebuff,
      ...freebuff,
      enabled: freebuff.enabled !== false,
      pollMs: clampNumber(freebuff.pollMs, BUILTIN.freebuff.pollMs, 250, 60_000),
      idlePollMs: clampNumber(freebuff.idlePollMs, BUILTIN.freebuff.idlePollMs, 500, 600_000),
      staleMs: clampNumber(freebuff.staleMs, BUILTIN.freebuff.staleMs, 5_000, 3_600_000),
      maxProjects: clampNumber(freebuff.maxProjects, BUILTIN.freebuff.maxProjects, 1, 24),
      explicitGraceMs: clampNumber(freebuff.explicitGraceMs, BUILTIN.freebuff.explicitGraceMs, 0, 3_600_000),
    },
    claudeTranscript: {
      ...BUILTIN.claudeTranscript,
      ...claudeTranscript,
      enabled: claudeTranscript.enabled !== false,
      pollMs: clampNumber(claudeTranscript.pollMs, BUILTIN.claudeTranscript.pollMs, 250, 60_000),
      activeMs: clampNumber(claudeTranscript.activeMs, BUILTIN.claudeTranscript.activeMs, 60_000, 86_400_000),
      stuckMs: clampNumber(claudeTranscript.stuckMs, BUILTIN.claudeTranscript.stuckMs, 60_000, 86_400_000),
      doneWindowMs: clampNumber(claudeTranscript.doneWindowMs, BUILTIN.claudeTranscript.doneWindowMs, 5_000, 3_600_000),
      explicitGraceMs: clampNumber(
        claudeTranscript.explicitGraceMs,
        BUILTIN.claudeTranscript.explicitGraceMs,
        0,
        3_600_000,
      ),
    },
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

/**
 * Decide whether one local source runs, given the file and the Settings toggle.
 *
 * Precedence is deliberate and one-way: a source switched off in `config.json`
 * is off, because a hand-edited file is a statement the app must not silently
 * undo. Otherwise the Settings toggle decides, and the file's `true` (or its
 * absence) is only a default. `readConfig` collapses an absent switch to
 * `true`, so `enabled === false` always means the file set it off.
 */
export function resolveSourceEnabled({ section = {}, prefEnabled = true, forceOff = false } = {}) {
  if (forceOff) return false;
  if (section && section.enabled === false) return false;
  return prefEnabled !== false;
}

/**
 * The three local sources the desktop app starts its daemon with. This is the
 * only place the file and the Settings toggle are combined, so the precedence
 * is exercised by the same code path the app runs.
 */
export function appSourceSwitches(base = {}, prefs = {}, { forceOff = false } = {}) {
  const connection = prefs?.connection || {};
  return {
    watch: resolveSourceEnabled({
      section: base.watch,
      prefEnabled: connection.freebuffWatcher !== false,
      forceOff,
    }),
    freebuff: resolveSourceEnabled({
      section: base.freebuff,
      prefEnabled: connection.freebuffDatabase !== false,
      forceOff,
    }),
    claudeTranscript: resolveSourceEnabled({
      section: base.claudeTranscript,
      prefEnabled: connection.claudeTranscript !== false,
      forceOff,
    }),
  };
}

/** Which switches config.json forced off, so Settings can show them locked. */
export function configSourceLocks(base = {}) {
  const locked = (section) => Boolean(section) && section.enabled === false;
  return {
    freebuffWatcher: { locked: locked(base.watch) },
    freebuffDatabase: { locked: locked(base.freebuff) },
    claudeTranscript: { locked: locked(base.claudeTranscript) },
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
    freebuff: { ...current.freebuff, ...(patch.freebuff || {}) },
    claudeTranscript: { ...current.claudeTranscript, ...(patch.claudeTranscript || {}) },
  };
  ensureBuffyDir(env);
  fs.writeFileSync(buffyFile('config.json', env), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
