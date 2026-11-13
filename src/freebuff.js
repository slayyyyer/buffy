/**
 * Read Freebuff Desktop's own session database, read-only.
 *
 * Freebuff writes `desktop-v2.db` per project under `~/.config/freebuff-desktop`.
 * The AGENTS.md instructions are still the primary, explicit signal: an agent
 * that runs `buffy event …` reports its reasoning and questions. This adapter
 * fills the gaps between those checkpoints by reading the recorded turn state,
 * and it is the only signal at all for projects where AGENTS.md was never
 * installed.
 *
 * The database is a private file the host app can change without notice, so
 * every read is optional: a missing column, a locked file, or an unexpected
 * shape leaves Buffy on whatever the other adapters reported.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { categoryForTool } from './events.js';

export const FREEBUFF_SESSION_ID = 'freebuff';
const DB_NAME = 'desktop-v2.db';

/** Projects older than this are still read, but ranked below recent ones. */
const PROJECT_WINDOW_MS = 10 * 60_000;

const FULL_THREAD_SQL = `
  select id, title, updated_at, turn_state, execution_target, agent_mode, attention_reason,
         last_turn_outcome, turn_alive_at, last_turn_finished_at
  from threads
  order by updated_at desc
  limit 1
`;

/** Builds before cloud execution have no `execution_target` column. */
const LEGACY_FULL_THREAD_SQL = `
  select id, title, updated_at, turn_state, agent_mode, attention_reason,
         last_turn_outcome, turn_alive_at, last_turn_finished_at
  from threads
  order by updated_at desc
  limit 1
`;

/** Older builds have no attention or liveness columns. */
const MINIMAL_THREAD_SQL = `
  select id, title, updated_at, turn_state, last_turn_outcome, last_turn_finished_at
  from threads
  order by updated_at desc
  limit 1
`;

export function freebuffProjectsRoot(env = process.env) {
  if (env.BUFFY_FREEBUFF_HOME) return path.resolve(env.BUFFY_FREEBUFF_HOME);
  return path.join(os.homedir(), '.config', 'freebuff-desktop', 'projects');
}

/** Newest project databases first, by the most recent write of the db or its WAL. */
export function listFreebuffProjects({ root = freebuffProjectsRoot(), limit = 8 } = {}) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, DB_NAME);
    let stamp = 0;
    for (const candidate of [`${file}-wal`, file]) {
      try {
        stamp = Math.max(stamp, fs.statSync(candidate).mtimeMs);
      } catch {
        /* the project has no database yet */
      }
    }
    if (!stamp) continue;
    found.push({ project: entry.name, file, stamp });
  }

  return found.sort((a, b) => b.stamp - a.stamp).slice(0, Math.max(1, limit));
}

export function normalizeParts(raw) {
  let parts = raw;
  if (typeof parts === 'string') {
    try {
      parts = JSON.parse(parts);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parts)) return [];
  return parts
    .filter((part) => part && typeof part === 'object' && part.kind !== 'ad')
    .map((part) => ({
      kind: String(part.kind || ''),
      toolName: typeof part.toolName === 'string' ? part.toolName : null,
      status: typeof part.status === 'string' ? part.status : null,
      exitCode: typeof part.exitCode === 'number' ? part.exitCode : null,
    }));
}

function toolFailed(part) {
  if (!part) return false;
  if (part.status === 'failure' || part.status === 'failed' || part.status === 'error') return true;
  return typeof part.exitCode === 'number' && part.exitCode !== 0;
}

function toolLive(part) {
  return Boolean(part && part.kind === 'tool' && (part.status === 'running' || part.status === 'pending' || part.status == null));
}

/**
 * Map a recorded turn onto one Buffy event.
 *
 * `null` means "nothing worth reporting": Buffy keeps whatever another source
 * said rather than clearing an unrelated agent's session.
 */
export function isCloudThread(thread) {
  return String(thread?.execution_target || '').toLowerCase() === 'cloud';
}

export function classifyFreebuffThread({
  thread,
  part = null,
  outType = null,
  queueRunning = false,
  now = Date.now(),
  staleMs = 120_000,
  cloudWindowMs = 120_000,
  doneWindowMs = 60_000,
  errorWindowMs = 10 * 60_000,
} = {}) {
  if (!thread) return null;

  const running = thread.turn_state === 'running';
  const updatedAt = Number(thread.updated_at) || 0;
  const finishedAt = Number(thread.last_turn_finished_at) || 0;
  const aliveAt = Number(thread.turn_alive_at) || updatedAt;

  // A cloud turn runs on Freebuff's servers and never writes `turn_state` or
  // `messages` here, so nothing local can describe it. Going silent would read
  // as idle during real work, so the thread row's own freshness becomes one
  // coarse state that says exactly what it is: out of view. Buffy never dresses
  // this up with a tool, a file, or a completion she did not see.
  if (isCloudThread(thread)) {
    const touched = Math.max(updatedAt, finishedAt);
    const live = running
      ? now - aliveAt <= staleMs || toolLive(part)
      : Boolean(touched) && now - touched <= cloudWindowMs;
    if (!live) return null;
    return {
      state: 'thinking',
      category: 'cloud',
      message: 'cloud turn, out of view',
      observed: 'inferred',
    };
  }

  if (running) {
    // A crashed session leaves turn_state behind. Without a heartbeat or a
    // live tool part, the turn is not really running any more, so Buffy stops
    // pretending along with it.
    const alive = now - aliveAt;
    if (alive > staleMs && !toolLive(part)) {
      return {
        state: 'idle',
        category: 'interrupted',
        message: 'Freebuff stopped reporting',
        observed: 'inferred',
      };
    }

    if (thread.attention_reason) {
      return {
        state: 'needs-you',
        category: 'question',
        message: attentionLabel(thread.attention_reason),
        observed: 'explicit',
      };
    }

    if (outType === 'error') {
      return { state: 'error', category: 'error', message: 'Freebuff turn failed', observed: 'explicit' };
    }

    if (!part) {
      return { state: 'thinking', category: 'thinking', message: 'starting a turn', observed: 'explicit' };
    }

    if (part.kind === 'tool') {
      const name = part.toolName || 'a tool';
      if (toolFailed(part)) {
        return { state: 'error', category: 'error', message: `${name} failed`, observed: 'explicit' };
      }
      return { state: 'working', category: categoryForTool(name), message: `using ${name}`, observed: 'explicit' };
    }

    switch (part.kind) {
      case 'reasoning':
        return { state: 'thinking', category: 'thinking', message: 'thinking it through', observed: 'explicit' };
      case 'text':
        return { state: 'working', category: 'thinking', message: 'writing a reply', observed: 'explicit' };
      case 'changes':
        return { state: 'working', category: 'editing', message: 'editing files', observed: 'explicit' };
      case 'compaction':
        return { state: 'working', category: 'compacting', message: 'compacting context', observed: 'explicit' };
      case 'agent':
        return { state: 'working', category: 'delegating', message: 'running a subagent', observed: 'explicit' };
      default:
        return { state: 'working', category: 'tool', message: 'working', observed: 'explicit' };
    }
  }

  if (queueRunning) {
    return { state: 'working', category: 'running', message: 'working through the queue', observed: 'explicit' };
  }

  if (thread.last_turn_outcome === 'failed' && now - Math.max(finishedAt, updatedAt) <= errorWindowMs) {
    return { state: 'error', category: 'error', message: 'Freebuff turn failed', observed: 'explicit' };
  }

  // A finished turn is reported once, inside a short window. Without that
  // window, opening Buffy hours later would replay an old completion.
  if (finishedAt && now - finishedAt <= doneWindowMs) {
    return {
      state: 'done',
      category: 'completion',
      message: 'turn finished',
      completionMessage: 'Freebuff finished its turn.',
      completedAt: finishedAt,
      observed: 'explicit',
    };
  }

  return null;
}

function attentionLabel(reason) {
  const text = String(reason || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'Freebuff is waiting for you';
  return `Freebuff is waiting: ${text.slice(0, 120)}`;
}

function signatureOf(event, project, threadId, cloudBucket = '') {
  return [
    event?.state,
    event?.category,
    event?.message,
    event?.completedAt || '',
    project || '',
    threadId || '',
    cloudBucket,
  ].join('|');
}

async function loadSqlite() {
  try {
    const module = await import('node:sqlite');
    if (module && typeof module.DatabaseSync === 'function') return module.DatabaseSync;
    return null;
  } catch {
    return null;
  }
}

function openReadOnly(DatabaseSync, file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 400');
  } catch {
    /* the pragma is best-effort */
  }
  return db;
}

function readThread(db) {
  for (const sql of [FULL_THREAD_SQL, LEGACY_FULL_THREAD_SQL, MINIMAL_THREAD_SQL]) {
    try {
      const row = db.prepare(sql).get();
      if (row) return row;
    } catch {
      /* column set differs; try the next query */
    }
  }
  return null;
}

function readTurnDetail(db, threadId) {
  let part = null;
  let outType = null;
  try {
    const row = db
      .prepare(
        `select json_extract(harness_state, '$.runtimeMove.parts') as parts,
                json_extract(harness_state, '$.runtimeMove.output.type') as outType
         from threads where id = ?`,
      )
      .get(threadId);
    if (row) {
      outType = row.outType ?? null;
      const parts = normalizeParts(row.parts);
      part = parts.length ? parts[parts.length - 1] : null;
    }
  } catch {
    /* older builds do not expose harness_state */
  }
  if (!part) {
    try {
      const row = db
        .prepare('select parts_json from messages where thread_id = ? order by seq desc limit 1')
        .get(threadId);
      if (row) {
        const parts = normalizeParts(row.parts_json);
        part = parts.length ? parts[parts.length - 1] : null;
      }
    } catch {
      /* the messages table is optional too */
    }
  }
  return { part, outType };
}

function readQueueRunning(db, threadId) {
  try {
    const row = db.prepare("select count(*) as c from queue_items where thread_id = ? and state = 'running'").get(threadId);
    return Boolean(row && Number(row.c) > 0);
  } catch {
    return false;
  }
}

/**
 * Poll the newest live Freebuff projects. Each tick reads at most `maxProjects`
 * databases, dispatches only when the mapped event actually changed, and
 * degrades to silence on any error.
 */
/** A change in this string means some project file (or its WAL) was written. */
export function projectsFingerprint(projects) {
  return projects.map((project) => `${project.project}:${project.stamp}`).join('|');
}

export function createFreebuffAdapter({
  root = freebuffProjectsRoot(),
  pollMs = 1000,
  idlePollMs = 5000,
  staleMs = 120_000,
  maxProjects = 4,
  doneWindowMs = 60_000,
  shouldYield = () => false,
  onEvent = () => {},
  onInfo = () => {},
  now = Date.now,
} = {}) {
  let timer = null;
  let closed = false;
  let started = false;
  let sqliteTried = false;
  let DatabaseSync = null;
  let lastSignature = null;
  let lastFingerprint = null;
  // Whether the last tick saw a live turn. A live turn is polled at the normal
  // cadence even when the files are still, because that is exactly how a
  // crashed turn is noticed. An idle one is not opened at all until it changes.
  let liveTurn = false;
  let opens = 0;
  let skipped = 0;
  let info = {
    enabled: true,
    available: false,
    root,
    projects: 0,
    reason: null,
    error: null,
  };

  function publish(patch) {
    info = { ...info, ...patch };
    try {
      onInfo({ ...info });
    } catch {
      /* an info listener must never break the poller */
    }
  }

  async function sample() {
    if (closed) return null;
    const at = now();

    const projects = listFreebuffProjects({ root, limit: 16 });
    if (!projects.length) {
      publish({ available: false, projects: 0, reason: 'no freebuff projects', error: null });
      return null;
    }

    if (!sqliteTried) {
      sqliteTried = true;
      DatabaseSync = await loadSqlite();
    }
    if (!DatabaseSync) {
      publish({ available: false, projects: projects.length, reason: 'node:sqlite unavailable', error: null });
      return null;
    }

    // The cheap gate: statting the project files is nearly free, so when
    // nothing on disk has moved since the last tick and no turn was running,
    // there is nothing a database read could tell us. Idle Buffy opens nothing.
    const fingerprint = projectsFingerprint(projects);
    if (fingerprint === lastFingerprint && !liveTurn) {
      skipped += 1;
      publish({ available: true, projects: projects.length, reason: null, error: null });
      return null;
    }
    lastFingerprint = fingerprint;

    const candidates = projects
      .filter((project) => at - project.stamp <= PROJECT_WINDOW_MS)
      .slice(0, Math.max(1, maxProjects));
    const pool = candidates.length ? candidates : projects.slice(0, 1);

    let best = null;
    for (const project of pool) {
      let db = null;
      try {
        opens += 1;
        db = openReadOnly(DatabaseSync, project.file);
        const thread = readThread(db);
        if (!thread) continue;
        const running = thread.turn_state === 'running';
        const alive = Number(thread.turn_alive_at) || 0;
        const fresh = running && (at - (alive || Number(thread.updated_at) || 0) <= staleMs);
        const score = (fresh ? 1e15 : 0) + (Number(thread.updated_at) || 0);
        if (!best || score > best.score) best = { ...project, thread, fresh, score };
      } catch (error) {
        publish({ error: String(error?.message || error).slice(0, 120) });
      } finally {
        try {
          db?.close();
        } catch {
          /* already closed */
        }
      }
    }

    if (!best) {
      liveTurn = false;
      publish({ available: true, projects: projects.length, reason: 'no threads', error: null });
      return null;
    }
    liveTurn = Boolean(best.fresh);

    let detail = { part: null, outType: null };
    let queueRunning = false;
    let db = null;
    try {
      opens += 1;
      db = openReadOnly(DatabaseSync, best.file);
      detail = readTurnDetail(db, best.thread.id);
      queueRunning = readQueueRunning(db, best.thread.id);
    } catch (error) {
      publish({ error: String(error?.message || error).slice(0, 120) });
    } finally {
      try {
        db?.close();
      } catch {
        /* already closed */
      }
    }

    const event = classifyFreebuffThread({
      thread: best.thread,
      part: detail.part,
      outType: detail.outType,
      queueRunning,
      now: at,
      staleMs,
      doneWindowMs,
    });

    publish({ available: true, projects: projects.length, reason: null, error: null });
    if (!event) return null;

    if (shouldYield(event)) return null;

    // A cloud turn has no finer detail to dispatch, so it is repeated at most
    // once every fifteen seconds while the row keeps moving. That is a
    // heartbeat, not a claim: it keeps the session out of the quiet state
    // without inventing progress.
    const cloudBucket = isCloudThread(best.thread)
      ? Math.floor((Number(best.thread.updated_at) || 0) / 15_000)
      : '';
    const signature = signatureOf(event, best.project, best.thread.id, cloudBucket);
    if (signature === lastSignature) return null;
    lastSignature = signature;

    const payload = { ...event, project: best.project, threadId: String(best.thread.id || '') };
    try {
      onEvent(payload);
    } catch {
      /* a listener error must never stop the poller */
    }
    return payload;
  }

  function schedule(delayMs) {
    if (closed) return;
    timer = setTimeout(() => {
      void tick();
    }, Math.max(200, Number(delayMs) || pollMs));
    timer.unref?.();
  }

  async function tick() {
    timer = null;
    try {
      await sample();
    } catch (error) {
      publish({ error: String(error?.message || error).slice(0, 120) });
    }
    // A live turn keeps the normal cadence so its heartbeat is still checked;
    // an idle one backs off until a project file actually changes.
    schedule(liveTurn ? pollMs : idlePollMs);
  }

  async function start() {
    if (started || closed) return;
    started = true;
    await tick();
  }

  function close() {
    closed = true;
    started = false;
    clearTimeout(timer);
    timer = null;
  }

  return {
    start,
    close,
    sample,
    state: () => ({ ...info, opens, skipped }),
    get polling() {
      return started && !closed;
    },
  };
}
