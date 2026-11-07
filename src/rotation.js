/**
 * Daily outfit rotation. Pure functions so the midnight, restart, busy and
 * unavailable-asset cases can be tested without the daemon or the desktop app.
 */

export function localDay(now = Date.now()) {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function setRotationEnabled(characterPrefs, enabled, now = Date.now()) {
  const rotation = { ...(characterPrefs?.rotation || {}) };
  if (enabled) {
    rotation.enabled = true;
    rotation.enabledOn = rotation.enabledOn || localDay(now);
  } else {
    rotation.enabled = false;
  }
  return { ...characterPrefs, rotation };
}

export function markManualLook(characterPrefs, now = Date.now()) {
  return {
    ...characterPrefs,
    rotation: { ...(characterPrefs?.rotation || {}), manualDay: localDay(now) },
  };
}

function availableLooks(catalog, characterId, prefs, isAvailable) {
  const character = prefs.characters?.[characterId];
  if (!character) return [];
  const builtins = Array.isArray(catalog?.builtinPresets)
    ? catalog.builtinPresets.filter(
        (preset) => !preset.characterId || preset.characterId === characterId,
      )
    : [];
  const saved = Array.isArray(character.looks) ? character.looks : [];
  return [...builtins, ...saved].filter((entry) => {
    if (!entry || !entry.look) return false;
    if (entry.includeInRotation === false) return false;
    return typeof isAvailable === 'function' ? isAvailable(entry.look) : true;
  });
}

/**
 * Decide whether the companion should change into its daily look.
 *
 * Rotation is opt-in, starts on the next local day after enabling, only runs
 * while resting, never rerolls after a manual change or a restart on the same
 * day, and skips unavailable artwork without consuming the day or deleting a
 * saved look.
 */
export function planRotation({
  prefs,
  catalog,
  characterId,
  now = Date.now(),
  resting = true,
  busy = false,
  composing = false,
  recording = false,
  settingsOpen = false,
  cardsOpen = false,
  isAvailable,
} = {}) {
  const character = prefs?.characters?.[characterId];
  const rotation = character?.rotation;
  const today = localDay(now);
  const base = { rotate: false, look: null, lookId: null, today, reason: 'disabled' };

  if (!rotation?.enabled) return base;
  if (!resting || busy || composing || recording || settingsOpen || cardsOpen) {
    return { ...base, reason: 'busy' };
  }
  if (rotation.enabledOn && today <= rotation.enabledOn) {
    return { ...base, reason: 'not-started' };
  }
  if (rotation.lastRotatedDay === today) {
    return { ...base, reason: 'already-rotated' };
  }
  if (rotation.manualDay === today) {
    return { ...base, reason: 'manual' };
  }

  const looks = availableLooks(catalog, characterId, prefs, isAvailable);
  if (!looks.length) return { ...base, reason: 'no-looks' };

  const previous = character.look || {};
  const previousId = looks.findIndex((entry) => {
    const look = entry.look || {};
    return ['outfit', 'bow', 'hat', 'glasses', 'wand'].every((key) => look[key] === previous[key]);
  });
  const next = looks[(previousId + 1 + looks.length) % looks.length];
  return {
    rotate: true,
    today,
    look: { ...next.look },
    lookId: next.id,
    name: next.name,
    reason: 'ready',
  };
}

export function rotationAfterApply(characterPrefs, plan, now = Date.now()) {
  if (!plan?.rotate) return characterPrefs;
  return {
    ...characterPrefs,
    rotation: {
      ...(characterPrefs.rotation || {}),
      lastRotatedDay: localDay(now),
    },
  };
}

/** Favorites bias a surprise pick without excluding the rest of the catalog. */
export function pickSurprise(catalog, characterId, characterPrefs, random = Math.random, isAvailable) {
  const outfits = (catalog?.slots?.find((slot) => slot.id === 'outfit')?.items || []).filter(
    (item) => (catalog?.characters?.find((character) => character.id === characterId)?.outfits || ['none']).includes(item.id),
  );
  const available = outfits.filter((item) => (typeof isAvailable === 'function' ? isAvailable({ outfit: item.id }) : true));
  if (!available.length) return null;
  const favorites = new Set(characterPrefs?.favorites || []);
  const favoriteLooks = (catalog?.builtinPresets || []).filter(
    (preset) => favorites.has(preset.id) && (!preset.characterId || preset.characterId === characterId),
  );
  if (favoriteLooks.length && random() < 0.45) {
    const pick = favoriteLooks[Math.floor(random() * favoriteLooks.length)];
    if (!isAvailable || isAvailable(pick.look)) return { ...pick.look, name: pick.name, id: pick.id };
  }
  const outfit = available[Math.floor(random() * available.length)];
  return { outfit: outfit.id };
}
