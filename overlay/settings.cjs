'use strict';

const DEFAULTS = { idleHobbies: true, sleepAfterMs: 120000 };

function normalizeOverlaySettings(raw) {
  const next = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const sleep = Number(next.sleepAfterMs);
  return {
    idleHobbies: next.idleHobbies !== false,
    sleepAfterMs: Number.isFinite(sleep)
      ? Math.min(600000, Math.max(30000, Math.round(sleep)))
      : DEFAULTS.sleepAfterMs,
  };
}

module.exports = { DEFAULTS, normalizeOverlaySettings };
