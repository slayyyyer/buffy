import fs from 'node:fs';
import path from 'node:path';

import { buffyFile, ensureBuffyDir } from './config.js';

export const PREFS_VERSION = 3;
export const MAX_SAVED_LOOKS = 32;

// The plush cloud used to be called Nimbus, so saved preferences can still
// carry the old character id.
const LEGACY_CHARACTER_IDS = { nimbus: 'buffy' };

export const SLOT_KEYS = ['outfit', 'bow', 'hat', 'glasses', 'wand', 'theme'];
export const CLOTHING_KEYS = ['outfit', 'bow', 'hat', 'glasses', 'wand'];

export const DEFAULT_PERSONALITY = Object.freeze({
  idleHobbies: true,
  extraIdleGestures: true,
  returnGreetings: true,
  sleepy: true,
  thoughtBubbles: 'off',
  reducedMotion: false,
  replyReactions: false,
  sleepAfterMs: 120000,
});

export const DEFAULT_ALERTS = Object.freeze({
  requests: false,
  completions: false,
  sounds: false,
  soundStyle: 'chime',
  soundVolume: 60,
  snoozeUntil: null,
});

export const DEFAULT_SHORTCUTS = Object.freeze({
  summon: 'CommandOrControl+Shift+B',
});

export const DEFAULT_PERMISSIONS = Object.freeze({
  claudeDecisions: false,
});

export const DEFAULT_PRIVACY = Object.freeze({
  hideFromCapture: true,
});

export function defaultCharacterPrefs(look) {
  return {
    look: { outfit: 'dress', bow: 'none', hat: 'none', glasses: 'none', wand: 'none', theme: 'plum', ...(look || {}) },
    clothing: { outfit: true, bow: true, hat: true, glasses: true, wand: true },
    favorites: [],
    looks: [],
    rotation: {
      enabled: false,
      enabledOn: null,
      lastRotatedDay: null,
      manualDay: null,
    },
  };
}

export function defaultPrefs() {
  return {
    version: PREFS_VERSION,
    companion: {
      name: 'Buffy',
      pronouns: 'she/her',
      characterId: 'buffy',
      theme: 'plum',
    },
    characters: {
      buffy: defaultCharacterPrefs(),
    },
    personality: { ...DEFAULT_PERSONALITY },
    shortcuts: { ...DEFAULT_SHORTCUTS },
    alerts: { ...DEFAULT_ALERTS },
    permissions: { ...DEFAULT_PERMISSIONS },
    privacy: { ...DEFAULT_PRIVACY },
    connection: {
      freebuffWatcher: true,
      freebuffDatabase: true,
      claudeTranscript: true,
    },
    updates: {
      deferWhileBusy: true,
    },
  };
}

function cleanText(value, max = 32) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\t]+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function sanitizeLook(raw, fallback = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const base = { ...defaultCharacterPrefs(fallback).look, ...fallback };
  const look = {};
  for (const key of SLOT_KEYS) {
    const value = typeof source[key] === 'string' ? source[key] : base[key];
    look[key] = value;
  }
  return look;
}

function sanitizeBooleanMap(raw, fallback) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const next = {};
  for (const key of CLOTHING_KEYS) {
    next[key] = typeof source[key] === 'boolean' ? source[key] : fallback[key];
  }
  return next;
}

export function normalizeSavedLooks(raw, now = Date.now()) {
  if (!Array.isArray(raw)) return [];
  const looks = [];
  const ids = new Set();
  const names = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const name = cleanText(entry.name, 40);
    if (!name) continue;
    const id = cleanText(entry.id, 80) || `look-${looks.length + 1}`;
    const lower = name.toLowerCase();
    if (ids.has(id) || names.has(lower)) continue;
    ids.add(id);
    names.add(lower);
    looks.push({
      id,
      name,
      look: sanitizeLook(entry.look),
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(now).toISOString(),
      includeInRotation: entry.includeInRotation !== false,
    });
    if (looks.length >= MAX_SAVED_LOOKS) break;
  }
  return looks;
}

function normalizeCharacter(raw, fallbackLook, now) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const base = defaultCharacterPrefs(fallbackLook);
  const rotation = source.rotation && typeof source.rotation === 'object' ? source.rotation : {};
  return {
    look: sanitizeLook(source.look, base.look),
    clothing: sanitizeBooleanMap(source.clothing, base.clothing),
    favorites: Array.isArray(source.favorites)
      ? [...new Set(source.favorites.filter((value) => typeof value === 'string' && value.trim()))].slice(0, 64)
      : [],
    looks: normalizeSavedLooks(source.looks, now),
    rotation: {
      enabled: rotation.enabled === true,
      enabledOn: typeof rotation.enabledOn === 'string' ? rotation.enabledOn.slice(0, 10) : null,
      lastRotatedDay: typeof rotation.lastRotatedDay === 'string' ? rotation.lastRotatedDay.slice(0, 10) : null,
      manualDay: typeof rotation.manualDay === 'string' ? rotation.manualDay.slice(0, 10) : null,
    },
  };
}

function normalizeSnooze(value, now) {
  const stamp = typeof value === 'string' ? Date.parse(value) : Number(value);
  if (!Number.isFinite(stamp)) return null;
  if (stamp <= now) return null;
  return new Date(stamp).toISOString();
}

/**
 * Merge legacy `wardrobe.json` (v1 flat or v2 flat + presets) and the old
 * `config.overlay` settings into version 3 preferences. Nothing is deleted:
 * old saved looks become character looks, and old outfit ids are mapped to the
 * current catalog ids.
 */
export function migrateLegacy({ wardrobe, overlay } = {}) {
  const prefs = defaultPrefs();
  const wardrobeRaw = wardrobe && typeof wardrobe === 'object' ? wardrobe : null;
  if (wardrobeRaw) {
    const legacyOutfit = wardrobeRaw.outfit;
    const outfit = legacyOutfit === 'princess' ? 'dress' : legacyOutfit === 'sleepover' ? 'overalls' : legacyOutfit;
    prefs.characters.buffy.look = sanitizeLook({ ...wardrobeRaw, outfit }, defaultPrefs().characters.buffy.look);
    if (Array.isArray(wardrobeRaw.presets)) {
      prefs.characters.buffy.looks = normalizeSavedLooks(
        wardrobeRaw.presets.map((preset) => ({
          id: preset.id,
          name: preset.name,
          look: {
            ...preset.look,
            outfit:
              preset.look?.outfit === 'princess'
                ? 'dress'
                : preset.look?.outfit === 'sleepover'
                  ? 'overalls'
                  : preset.look?.outfit,
          },
          createdAt: preset.createdAt,
          includeInRotation: true,
        })),
      );
    }
  }

  if (overlay && typeof overlay === 'object') {
    if (typeof overlay.idleHobbies === 'boolean') prefs.personality.idleHobbies = overlay.idleHobbies;
    if (Number.isFinite(Number(overlay.sleepAfterMs))) {
      prefs.personality.sleepAfterMs = Math.min(600000, Math.max(30000, Math.round(Number(overlay.sleepAfterMs))));
    }
  }
  return prefs;
}

function migrateCharacterIds(raw) {
  const characters =
    raw.characters && typeof raw.characters === 'object' && !Array.isArray(raw.characters) ? raw.characters : null;
  const companion = raw.companion && typeof raw.companion === 'object' ? raw.companion : null;
  let nextCharacters = characters;
  if (characters) {
    const legacyIds = Object.keys(characters).filter((id) => LEGACY_CHARACTER_IDS[id]);
    if (legacyIds.length) {
      nextCharacters = { ...characters };
      for (const id of legacyIds) {
        const target = LEGACY_CHARACTER_IDS[id];
        if (!nextCharacters[target]) nextCharacters[target] = nextCharacters[id];
        delete nextCharacters[id];
      }
    }
  }
  let nextCompanion = companion;
  if (companion && LEGACY_CHARACTER_IDS[companion.characterId]) {
    nextCompanion = { ...companion, characterId: LEGACY_CHARACTER_IDS[companion.characterId] };
  }
  if (nextCharacters === characters && nextCompanion === companion) return raw;
  return { ...raw, characters: nextCharacters ?? raw.characters, companion: nextCompanion ?? raw.companion };
}

export function normalizePrefs(raw, { now = Date.now(), legacyWardrobe, legacyOverlay } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Number(raw.version) < PREFS_VERSION) {
    return migrateLegacy({ wardrobe: legacyWardrobe ?? raw, overlay: legacyOverlay });
  }

  raw = migrateCharacterIds(raw);

  const base = defaultPrefs();
  const companion = raw.companion && typeof raw.companion === 'object' ? raw.companion : {};
  const personality = raw.personality && typeof raw.personality === 'object' ? raw.personality : {};
  const shortcuts = raw.shortcuts && typeof raw.shortcuts === 'object' ? raw.shortcuts : {};
  const alerts = raw.alerts && typeof raw.alerts === 'object' ? raw.alerts : {};
  const permissions = raw.permissions && typeof raw.permissions === 'object' ? raw.permissions : {};
  const privacy = raw.privacy && typeof raw.privacy === 'object' ? raw.privacy : {};
  const connection = raw.connection && typeof raw.connection === 'object' ? raw.connection : {};
  const updates = raw.updates && typeof raw.updates === 'object' ? raw.updates : {};

  const prefs = {
    version: PREFS_VERSION,
    companion: {
      name: cleanText(companion.name, 32) || base.companion.name,
      pronouns: cleanText(companion.pronouns, 24) || base.companion.pronouns,
      characterId: cleanText(companion.characterId, 40) || base.companion.characterId,
      theme: cleanText(companion.theme, 24) || base.companion.theme,
    },
    characters: {},
    personality: {
      idleHobbies:
        typeof personality.idleHobbies === 'boolean' ? personality.idleHobbies : base.personality.idleHobbies,
      extraIdleGestures:
        typeof personality.extraIdleGestures === 'boolean'
          ? personality.extraIdleGestures
          : base.personality.extraIdleGestures,
      returnGreetings:
        typeof personality.returnGreetings === 'boolean'
          ? personality.returnGreetings
          : base.personality.returnGreetings,
      sleepy: typeof personality.sleepy === 'boolean' ? personality.sleepy : base.personality.sleepy,
      thoughtBubbles: ['off', 'emoji', 'words'].includes(personality.thoughtBubbles)
        ? personality.thoughtBubbles
        : base.personality.thoughtBubbles,
      reducedMotion: personality.reducedMotion === true,
      replyReactions: personality.replyReactions === true,
      sleepAfterMs: Number.isFinite(Number(personality.sleepAfterMs))
        ? Math.min(600000, Math.max(30000, Math.round(Number(personality.sleepAfterMs))))
        : base.personality.sleepAfterMs,
    },
    shortcuts: {
      summon: cleanText(shortcuts.summon, 80) || base.shortcuts.summon,
    },
    alerts: {
      requests: alerts.requests === true,
      completions: alerts.completions === true,
      sounds: alerts.sounds === true,
      soundStyle: alerts.soundStyle === 'beep' ? 'beep' : 'chime',
      soundVolume: Number.isFinite(Number(alerts.soundVolume))
        ? Math.min(100, Math.max(0, Math.round(Number(alerts.soundVolume))))
        : base.alerts.soundVolume,
      snoozeUntil: normalizeSnooze(alerts.snoozeUntil, now),
    },
    permissions: {
      claudeDecisions: permissions.claudeDecisions === true,
    },
    privacy: {
      // Kept out of screen capture unless explicitly switched off.
      hideFromCapture: privacy.hideFromCapture !== false,
    },
    connection: {
      freebuffWatcher: connection.freebuffWatcher !== false,
      // Both evidence sources read local files. They are on by default and
      // every value except an explicit false leaves them on.
      freebuffDatabase: connection.freebuffDatabase !== false,
      claudeTranscript: connection.claudeTranscript !== false,
    },
    updates: {
      deferWhileBusy: updates.deferWhileBusy !== false,
    },
  };

  const characters = raw.characters && typeof raw.characters === 'object' && !Array.isArray(raw.characters)
    ? raw.characters
    : {};
  for (const [id, value] of Object.entries(characters)) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) continue;
    prefs.characters[id] = normalizeCharacter(value, base.characters.buffy.look, now);
  }
  if (!prefs.characters.buffy) prefs.characters.buffy = defaultCharacterPrefs();
  if (!prefs.characters[prefs.companion.characterId]) {
    prefs.characters[prefs.companion.characterId] = defaultCharacterPrefs();
  }
  return prefs;
}

export function loadPrefs({ env = process.env, legacyWardrobe, legacyOverlay, now = Date.now() } = {}) {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(buffyFile('preferences.json', env), 'utf8'));
  } catch {
    /* first run or a malformed file falls back to migration */
  }
  return normalizePrefs(raw, { now, legacyWardrobe, legacyOverlay });
}

export function savePrefs(prefs, env = process.env) {
  ensureBuffyDir(env);
  const file = buffyFile('preferences.json', env);
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(prefs, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return file;
}

export function getCharacterPrefs(prefs, characterId) {
  return prefs.characters[characterId] || defaultCharacterPrefs();
}

export function updateCharacterPrefs(prefs, characterId, patch) {
  const current = getCharacterPrefs(prefs, characterId);
  const next = {
    ...current,
    ...(patch && typeof patch === 'object' ? patch : {}),
    look: patch?.look ? sanitizeLook(patch.look, current.look) : current.look,
    clothing: patch?.clothing ? sanitizeBooleanMap(patch.clothing, current.clothing) : current.clothing,
    favorites: Array.isArray(patch?.favorites)
      ? [...new Set(patch.favorites.filter((value) => typeof value === 'string'))].slice(0, 64)
      : current.favorites,
    looks: patch?.looks ? normalizeSavedLooks(patch.looks) : current.looks,
    rotation: patch?.rotation ? { ...current.rotation, ...patch.rotation } : current.rotation,
  };
  prefs.characters = { ...prefs.characters, [characterId]: next };
  return next;
}

export function setAlertsSnooze(prefs, durationMs, now = Date.now()) {
  prefs.alerts.snoozeUntil = durationMs > 0 ? new Date(now + durationMs).toISOString() : null;
  return prefs;
}

export function pruneExpiredSnooze(prefs, now = Date.now()) {
  if (prefs.alerts.snoozeUntil && Date.parse(prefs.alerts.snoozeUntil) <= now) {
    prefs.alerts.snoozeUntil = null;
  }
  return prefs;
}

export function prefsFilePath(env = process.env) {
  return path.join(buffyFile('.', env), 'preferences.json').replace(/[\\/]\.([\\/])/, '$1');
}
