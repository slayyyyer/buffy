'use strict';

function parseVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => {
      const number = parseInt(part, 10);
      return Number.isFinite(number) ? number : 0;
    });
}

// The updater can hand back a cached download after a manual install. Only a
// strictly newer version is worth prompting for, so compare the numeric parts
// instead of trusting whatever update feed payload showed up.
function isNewerVersion(candidate, current) {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  const length = Math.max(next.length, now.length);
  for (let index = 0; index < length; index += 1) {
    const a = next[index] || 0;
    const b = now[index] || 0;
    if (a !== b) return a > b;
  }
  return false;
}

module.exports = { parseVersion, isNewerVersion };
