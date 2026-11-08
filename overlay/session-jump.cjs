'use strict';

const fs = require('node:fs');

// Absolute Windows (C:\ or \\server\share), and POSIX paths only. The overlay
// opens this folder, so a relative or malformed value is never accepted.
function isAbsolutePath(value) {
  return /^([a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/]|\/)/.test(value);
}

function cleanPath(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\t]+/g, ' ').trim();
  if (!text || text.length > 512) return null;
  return isAbsolutePath(text) ? text : null;
}

function cleanSessionId(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
  return text || null;
}

/** Read the untrusted renderer payload into a small, validated target. */
function sessionTarget(payload = {}) {
  return {
    sessionId: cleanSessionId(payload?.sessionId),
    cwd: cleanPath(payload?.cwd),
  };
}

/** Only return the folder when it still exists and is a directory. */
function directoryFor(cwd, statSync = fs.statSync) {
  if (!cwd) return null;
  try {
    return statSync(cwd).isDirectory() ? cwd : null;
  } catch {
    return null;
  }
}

module.exports = { isAbsolutePath, cleanPath, sessionTarget, directoryFor };
