import { DEFAULT_SESSION_TTL_MS, STATES } from './config.js';

const ALIASES = new Map([
  ['needs_you', 'needs-you'],
  ['needsyou', 'needs-you'],
  ['waiting', 'needs-you'],
  ['blocked', 'needs-you'],
  ['input', 'needs-you'],
  ['success', 'done'],
  ['finished', 'done'],
  ['complete', 'done'],
  ['completed', 'done'],
  ['failed', 'error'],
  ['failure', 'error'],
  ['err', 'error'],
  ['busy', 'working'],
  ['edit', 'working'],
  ['tool', 'working'],
]);

const DEFAULT_SESSION = 'default';
const SESSION_MAX = 96;

/** Higher values are more urgent when several sessions are active. */
export const SESSION_PRIORITY = Object.freeze({
  idle: 0,
  done: 1,
  thinking: 2,
  working: 3,
  error: 4,
  'needs-you': 5,
});

export function normalizeState(input) {
  const raw = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
  const key = ALIASES.get(raw) || raw;
  if (!STATES.includes(key)) {
    throw new Error(`unknown state "${input}". Use one of: ${STATES.join(', ')}`);
  }
  return key;
}

export function normalizeSessionId(input) {
  const raw = String(input ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, SESSION_MAX);
  return raw || DEFAULT_SESSION;
}

/**
 * Session-aware state machine.
 *
 * Each agent/session owns one state. The visible state is the most urgent
 * active session; ties go to the most recent event. A done state holds for
 * doneHoldMs, then that session disappears; stale sessions expire after
 * sessionTtlMs. Untagged events fall back to their source, so older callers
 * still get last-event-wins behavior without overwriting a different agent.
 */
export function createMachine({ doneHoldMs = 4000, sessionTtlMs = DEFAULT_SESSION_TTL_MS } = {}) {
  const hold = Math.max(0, Number(doneHoldMs) || 0);
  const ttlValue = Number(sessionTtlMs);
  const ttl = Number.isFinite(ttlValue) ? Math.max(0, ttlValue) : DEFAULT_SESSION_TTL_MS;

  const sessions = new Map();
  let idle = { state: 'idle', message: null, source: null, since: Date.now(), seq: 0 };
  let seq = 0;
  let lastSource = null;

  function nextSeq() {
    seq += 1;
    return seq;
  }

  function sessionIdFor(event) {
    return normalizeSessionId(event.sessionId || event.session || event.source || DEFAULT_SESSION);
  }

  function publicSession(session) {
    return {
      id: session.id,
      state: session.state,
      message: session.message,
      source: session.source,
      since: session.since,
      updatedAt: session.updatedAt,
      seq: session.seq,
      until: session.state === 'done' ? session.doneUntil : null,
    };
  }

  function markIdle(now, source) {
    idle = {
      state: 'idle',
      message: null,
      source: source ?? lastSource,
      since: now,
      seq: nextSeq(),
    };
  }

  function settle(now) {
    let changed = false;
    for (const [id, session] of sessions) {
      const done = session.state === 'done' && session.doneUntil !== null && now >= session.doneUntil;
      const expired = ttl > 0 && now - session.updatedAt >= ttl;
      if (done || expired) {
        sessions.delete(id);
        changed = true;
      }
    }
    if (changed && sessions.size === 0) markIdle(now, lastSource);
    return changed;
  }

  function ordered() {
    return [...sessions.values()].sort((a, b) => {
      const priority = (SESSION_PRIORITY[b.state] ?? 0) - (SESSION_PRIORITY[a.state] ?? 0);
      return priority || b.seq - a.seq;
    });
  }

  function snapshot(now = Date.now()) {
    settle(now);
    const active = ordered();
    if (!active.length) {
      return {
        ...idle,
        sessionId: null,
        until: null,
        sessions: [],
        now,
      };
    }

    const top = active[0];
    return {
      state: top.state,
      message: top.message,
      source: top.source,
      since: top.since,
      seq: top.seq,
      sessionId: top.id,
      until: top.state === 'done' ? top.doneUntil : null,
      sessions: active.map(publicSession),
      now,
    };
  }

  function dispatch(event, now = Date.now()) {
    const state = normalizeState(event.state);
    const id = sessionIdFor(event);
    const message = event.message ? String(event.message).slice(0, 240) : null;
    const source = event.source ? String(event.source).slice(0, 40) : null;
    const eventSeq = nextSeq();
    if (source) lastSource = source;

    if (state === 'idle') {
      sessions.delete(id);
      if (sessions.size === 0) {
        idle = {
          state: 'idle',
          message: null,
          source: source ?? lastSource,
          since: now,
          seq: eventSeq,
        };
      }
    } else {
      sessions.set(id, {
        id,
        state,
        message,
        source,
        since: now,
        updatedAt: now,
        seq: eventSeq,
        doneUntil: state === 'done' ? now + hold : null,
      });
    }

    return snapshot(now);
  }

  function tick(now = Date.now()) {
    let expired = false;
    for (const session of sessions.values()) {
      if (
        (session.state === 'done' && session.doneUntil !== null && now >= session.doneUntil) ||
        (ttl > 0 && now - session.updatedAt >= ttl)
      ) {
        expired = true;
        break;
      }
    }
    if (!expired) return false;
    settle(now);
    return true;
  }

  function getSession(id) {
    const session = sessions.get(normalizeSessionId(id));
    return session ? publicSession(session) : null;
  }

  return { dispatch, tick, snapshot, getSession };
}
