import fs from 'node:fs';

import { buffyFile, ensureBuffyDir } from './config.js';
import { paletteFromSeed } from './palette.js';

export const STATE_VERSION = 1;

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function levelFromXp(xp) {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 50));
}

export function xpForLevel(level) {
  return Math.max(0, level - 1) ** 2 * 50;
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

export function createState({ name = 'Momo', seed = randomSeed(), now = Date.now() } = {}) {
  const iso = new Date(now).toISOString();
  const safeName = String(name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 32) || 'Momo';
  return {
    version: STATE_VERSION,
    pet: {
      name: safeName,
      seed,
      createdAt: iso,
      sprite: { type: 'placeholder', seed, palette: paletteFromSeed(seed) },
    },
    xp: 0,
    mood: 70,
    createdAt: iso,
    lastSeen: iso,
    counters: { events: 0, pets: 0, sessions: 0 },
  };
}

export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const base = createState({ now: Date.now() });
  const state = { ...base, ...raw };
  const pet = raw.pet && typeof raw.pet === 'object' ? raw.pet : {};
  const seed = Number.isFinite(pet.seed) ? pet.seed : base.pet.seed;
  state.pet = {
    ...base.pet,
    ...pet,
    seed,
    name: String(pet.name || base.pet.name).slice(0, 32),
    sprite: pet.sprite && typeof pet.sprite === 'object'
      ? { type: 'placeholder', seed, palette: paletteFromSeed(seed), ...pet.sprite }
      : { type: 'placeholder', seed, palette: paletteFromSeed(seed) },
  };
  state.xp = Number.isFinite(raw.xp) ? Math.max(0, Math.floor(raw.xp)) : 0;
  state.mood = Number.isFinite(raw.mood) ? clamp(raw.mood, 0, 100) : 70;
  state.counters = { events: 0, pets: 0, sessions: 0, ...(raw.counters || {}) };
  return state;
}

export function loadState(env = process.env) {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(buffyFile('state.json', env), 'utf8')));
  } catch {
    return null;
  }
}

export function saveState(state, env = process.env) {
  ensureBuffyDir(env);
  const file = buffyFile('state.json', env);
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** Being ignored makes a buffy a little quieter. */
export function applyIdleDecay(state, now = Date.now()) {
  const last = Date.parse(state.lastSeen || '') || now;
  const hours = Math.max(0, (now - last) / 3_600_000);
  if (hours >= 6) state.mood = clamp(state.mood - Math.floor(hours / 6), 15, 100);
  return hours;
}
