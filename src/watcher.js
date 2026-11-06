import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const GIT_ARGS = ['status', '--porcelain=v1', '-uall'];

function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Match a relative path against simple directory names or `*` globs. */
export function isIgnored(relativePath, patterns = []) {
  const relative = String(relativePath || '').replace(/\\/g, '/');
  if (!relative) return false;
  const parts = relative.split('/').filter(Boolean);

  for (const pattern of patterns) {
    if (!pattern) continue;
    const normalized = String(pattern).replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalized) continue;

    if (normalized.includes('*')) {
      const regex = globToRegex(normalized);
      if (regex.test(relative) || parts.some((part) => regex.test(part))) return true;
    } else if (parts.includes(normalized) || relative === normalized || relative.startsWith(`${normalized}/`)) {
      return true;
    }
  }
  return false;
}

/**
 * Watch a directory without dependencies.
 *
 * `fs.watch` catches working-tree churn; a lightweight `git status` poll catches
 * index-only changes (stage, checkout, branch switch) that never touch a file.
 * Events are coalesced: at most one `onWorking` per `minEmitMs`, then one
 * `onQuiet` after `quietMs` of no changes.
 */
export function createWatcher({
  directory,
  quietMs = 2500,
  pollMs = 700,
  ignore = [],
  minEmitMs = 600,
  onWorking = () => {},
  onQuiet = () => {},
  onError = () => {},
  now = Date.now,
} = {}) {
  const root = path.resolve(directory || process.cwd());
  const quietWindow = Math.max(0, Number(quietMs) || 0);
  const pollEvery = Math.max(50, Number(pollMs) || 700);
  const emitEvery = Math.max(0, Number(minEmitMs) || 0);
  const gitTracked = fs.existsSync(path.join(root, '.git'));

  let closed = false;
  let fsWatcher = null;
  let pollTimer = null;
  let quietTimer = null;
  let lastEmit = 0;
  let gitSignature = null;

  function relativeOf(filename) {
    if (!filename) return '';
    const absolute = path.resolve(root, String(filename));
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return '';
    return relative.replace(/\\/g, '/');
  }

  function markChurn(relative) {
    if (closed) return;

    const at = now();
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => {
      quietTimer = null;
      if (!closed) onQuiet();
    }, quietWindow);
    quietTimer.unref?.();

    if (at - lastEmit >= emitEvery) {
      lastEmit = at;
      onWorking({ file: relative ? path.basename(relative) : null, path: relative || null });
    }
  }

  function pollGit() {
    execFile(
      'git',
      GIT_ARGS,
      { cwd: root, timeout: 2000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (closed || error) return;
        const next = String(stdout);
        if (gitSignature !== null && next !== gitSignature) markChurn(null);
        gitSignature = next;
      },
    );
  }

  function start() {
    try {
      fsWatcher = fs.watch(root, { recursive: true }, (_event, filename) => {
        const relative = relativeOf(filename);
        if (relative && isIgnored(relative, ignore)) return;
        markChurn(relative);
      });
      fsWatcher.on('error', (error) => onError(error));
    } catch (error) {
      onError(error);
    }

    if (gitTracked) {
      pollGit();
      pollTimer = setInterval(pollGit, pollEvery);
      pollTimer.unref?.();
    }
  }

  function close() {
    closed = true;
    clearTimeout(quietTimer);
    clearInterval(pollTimer);
    quietTimer = null;
    pollTimer = null;
    try {
      fsWatcher?.close();
    } catch {
      /* already closed */
    }
    fsWatcher = null;
  }

  return {
    start,
    close,
    root,
    quietMs: quietWindow,
    pollMs: pollEvery,
    git: gitTracked,
  };
}
