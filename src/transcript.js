/**
 * A zero-config Claude Code signal, for when the hook is not installed, was
 * removed by an update, or its launcher points at a moved install.
 *
 * Claude Code writes one JSONL transcript per session under
 * `~/.claude/projects/<slug>/<session-id>.jsonl`. The filename is the same
 * session id the hook reports, so the two sources share one Buffy session:
 * while the hook is delivering events this adapter stays silent, and when the
 * hook goes quiet the transcript keeps the session alive.
 *
 * Nothing here claims a test passed. A tool call without a result is "working",
 * a finished assistant turn is "done", and a long silence ends the session.
 * Everything is reported as `inferred` because it comes from reading files.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { categoryForTool } from './events.js';

const TAIL_BYTES = 192 * 1024;

export function claudeProjectsRoot(env = process.env) {
  const base = env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

/** Newest transcripts inside the active window, newest first. */
export function listTranscripts({ root = claudeProjectsRoot(), now = Date.now(), activeMs = 15 * 60_000, limit = 2 } = {}) {
  let slugs = [];
  try {
    slugs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const found = [];
  for (const slug of slugs) {
    if (!slug.isDirectory()) continue;
    const dir = path.join(root, slug.name);
    let files = [];
    try {
      files = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      const absolute = path.join(dir, file.name);
      let stat;
      try {
        stat = fs.statSync(absolute);
      } catch {
        continue;
      }
      if (now - stat.mtimeMs > activeMs) continue;
      found.push({
        file: absolute,
        sessionId: file.name.slice(0, -'.jsonl'.length),
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
  }

  return found.sort((a, b) => b.mtime - a.mtime).slice(0, Math.max(1, limit));
}

/** The last `maxBytes` of a file, starting on a line boundary. */
export function readTail(file, maxBytes = TAIL_BYTES) {
  const stat = fs.statSync(file);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  if (length <= 0) return { text: '', size: stat.size, mtime: stat.mtimeMs };

  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }

  let text = buffer.toString('utf8');
  if (start > 0) {
    const newline = text.indexOf('\n');
    if (newline >= 0) text = text.slice(newline + 1);
  }
  return { text, size: stat.size, mtime: stat.mtimeMs };
}

export function parseEntries(text) {
  const entries = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed);
      if (value && typeof value === 'object') entries.push(value);
    } catch {
      /* a partially written last line is normal */
    }
  }
  return entries;
}

function blocksOf(entry) {
  const content = entry?.message?.content;
  if (Array.isArray(content)) return content.filter((block) => block && typeof block === 'object');
  return [];
}

function timeOf(entry) {
  const stamp = Date.parse(entry?.timestamp || '');
  return Number.isFinite(stamp) ? stamp : null;
}

/**
 * Turn the tail of a transcript into one event, or null when it says nothing.
 *
 * `doneWindowMs` keeps a completion from being replayed when Buffy starts long
 * after a turn ended; `stuckMs` is the abandon threshold for a tool call that
 * never returned (the hook would have reported a permission prompt instead).
 */
export function classifyTranscript(entries, { now = Date.now(), doneWindowMs = 60_000, stuckMs = 10 * 60_000 } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return null;

  const cwd = (() => {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const value = typeof list[i]?.cwd === 'string' ? list[i].cwd.trim() : '';
      if (value) return value;
    }
    return null;
  })();

  const results = new Set();
  for (const entry of list) {
    for (const block of blocksOf(entry)) {
      if (block.type === 'tool_result' && block.tool_use_id) results.add(block.tool_use_id);
    }
  }

  let pending = null;
  for (let i = list.length - 1; i >= 0 && !pending; i -= 1) {
    for (const block of blocksOf(list[i])) {
      if (block.type === 'tool_use' && block.id && !results.has(block.id)) {
        pending = { name: String(block.name || 'a tool'), at: timeOf(list[i]) };
        break;
      }
    }
  }

  if (pending) {
    const age = now - (pending.at ?? now);
    if (age >= stuckMs) {
      return {
        state: 'idle',
        category: 'interrupted',
        message: 'Claude stopped reporting',
        observed: 'inferred',
        cwd,
      };
    }
    return {
      state: 'working',
      category: categoryForTool(pending.name),
      message: `using ${pending.name}`,
      observed: 'inferred',
      cwd,
    };
  }

  const last = list[list.length - 1];
  const lastBlocks = blocksOf(last);
  const hasText = lastBlocks.some((block) => block.type === 'text' && String(block.text || '').trim());
  const stop = last?.message?.stop_reason ?? null;
  const at = timeOf(last);

  if (last?.type === 'assistant' && hasText && (stop === 'end_turn' || stop === 'stop_sequence')) {
    if (!at || now - at > doneWindowMs) return null;
    return {
      state: 'done',
      category: 'completion',
      message: 'turn finished',
      completionMessage: 'Claude finished a turn.',
      completedAt: at,
      observed: 'inferred',
      cwd,
    };
  }

  if (last?.type === 'user' && !lastBlocks.some((block) => block.type === 'tool_result')) {
    return {
      state: 'thinking',
      category: 'thinking',
      message: 'thinking about your prompt',
      observed: 'inferred',
      cwd,
    };
  }

  return null;
}

function signatureOf(event, sessionId) {
  return [sessionId, event?.state, event?.category, event?.message, event?.completedAt || ''].join('|');
}

export function createTranscriptAdapter({
  root = claudeProjectsRoot(),
  pollMs = 1500,
  activeMs = 15 * 60_000,
  doneWindowMs = 60_000,
  stuckMs = 10 * 60_000,
  shouldYield = () => false,
  onEvent = () => {},
  onInfo = () => {},
  now = Date.now,
} = {}) {
  let timer = null;
  let closed = false;
  const seen = new Map();
  const lastSignature = new Map();
  let info = { enabled: true, available: false, root, transcripts: 0, reason: null, error: null };

  function publish(patch) {
    info = { ...info, ...patch };
    try {
      onInfo({ ...info });
    } catch {
      /* an info listener must never break the poller */
    }
  }

  function sample() {
    if (closed) return null;
    const at = now();
    const transcripts = listTranscripts({ root, now: at, activeMs, limit: 2 });
    if (!transcripts.length) {
      publish({ available: false, transcripts: 0, reason: 'no recent claude sessions', error: null });
      return null;
    }

    let dispatched = null;
    for (const transcript of transcripts) {
      const previous = seen.get(transcript.file);
      const unchanged = previous && previous.size === transcript.size && previous.mtime === transcript.mtime;
      if (unchanged && at - previous.readAt < 15_000) continue;
      seen.set(transcript.file, { size: transcript.size, mtime: transcript.mtime, readAt: at });

      let entries;
      try {
        entries = parseEntries(readTail(transcript.file).text);
      } catch (error) {
        publish({ error: String(error?.message || error).slice(0, 120) });
        continue;
      }

      const event = classifyTranscript(entries, { now: at, doneWindowMs, stuckMs });
      if (!event) continue;

      const payload = { ...event, sessionId: transcript.sessionId };
      if (shouldYield(payload)) continue;

      const signature = signatureOf(event, transcript.sessionId);
      if (lastSignature.get(transcript.sessionId) === signature) continue;

      lastSignature.set(transcript.sessionId, signature);
      try {
        onEvent(payload);
        dispatched = payload;
        break;
      } catch (error) {
        publish({ error: String(error?.message || error).slice(0, 120) });
      }
    }

    publish({ available: true, transcripts: transcripts.length, reason: null, error: null });
    return dispatched;
  }

  async function start() {
    if (timer || closed) return;
    sample();
    if (closed) return;
    timer = setInterval(() => {
      try {
        sample();
      } catch (error) {
        publish({ error: String(error?.message || error).slice(0, 120) });
      }
    }, Math.max(250, pollMs));
    timer.unref?.();
  }

  function close() {
    closed = true;
    clearInterval(timer);
    timer = null;
  }

  return { start, close, sample, state: () => ({ ...info }), get polling() { return Boolean(timer); } };
}
