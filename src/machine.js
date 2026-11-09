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
const REQUEST_MAX = 24;

/** Higher values are more urgent when several sessions are active. */
export const SESSION_PRIORITY = Object.freeze({
  idle: 0,
  done: 1,
  thinking: 2,
  working: 3,
  error: 4,
  'needs-you': 5,
});

export const ACTIVITY_CATEGORIES = Object.freeze([
  'thinking',
  'reading',
  'searching',
  'editing',
  'running',
  'delegating',
  'compacting',
  'planning',
  'tool',
  'waiting',
  'permission',
  'question',
  'completion',
  'interrupted',
  'session-end',
  'idle-reminder',
  'error',
  'editing-inferred',
  'settled-inferred',
]);

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

function normalizeCategory(value, fallback = 'tool') {
  if (!value) return fallback;
  const category = String(value).trim().toLowerCase();
  return ACTIVITY_CATEGORIES.includes(category) ? category : fallback;
}

function clean(value, max = 240) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\t]+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function fingerprint(parts) {
  const text = parts.filter(Boolean).join('|');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp-${(hash >>> 0).toString(36)}`;
}

function requestIdFor(sessionId, request) {
  return (
    clean(request.id, 120) ||
    clean(request.toolUseId, 120) ||
    fingerprint([sessionId, request.kind, request.label, request.toolName])
  );
}

/**
 * Session-aware activity model.
 *
 * Each agent/session owns one visible state and its own outstanding requests.
 * A permission prompt or question survives unrelated parallel tool completions;
 * only a matching request id (or a safe tool-name fallback) resolves it.
 *
 * Three distinct lifecycles are kept apart:
 *  - `done` is presented for doneHoldMs (about 30s by default);
 *  - a recent completion stays in `recentCompletions` for recentCompletionMs
 *    (about five minutes) even after an idle reminder or after the presentation
 *    window ends;
 *  - a quiet session expires after sessionTtlMs (about 30 minutes).
 */
export function createMachine({
  doneHoldMs = 30_000,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  recentCompletionMs = 5 * 60_000,
} = {}) {
  const hold = Math.max(0, Number(doneHoldMs) || 0);
  const ttlValue = Number(sessionTtlMs);
  const ttl = Number.isFinite(ttlValue) ? Math.max(0, ttlValue) : DEFAULT_SESSION_TTL_MS;
  const recentHoldValue = Number(recentCompletionMs);
  const recentHold = Number.isFinite(recentHoldValue) ? Math.max(0, recentHoldValue) : 5 * 60_000;

  const sessions = new Map();
  const recentCompletions = new Map();
  let idle = { state: 'idle', message: null, source: null, since: Date.now(), seq: 0 };
  let seq = 0;
  let lastSource = null;
  let lastIdleReminder = null;

  function nextSeq() {
    seq += 1;
    return seq;
  }

  function sessionIdFor(event) {
    return normalizeSessionId(event.sessionId || event.session || event.source || DEFAULT_SESSION);
  }

  function publicRequest(request) {
    return {
      id: request.id,
      kind: request.kind,
      label: request.label,
      toolName: request.toolName,
      decisionId: request.decisionId ?? null,
      createdAt: request.createdAt,
    };
  }

  function publicSession(session) {
    const requests = [...session.requests.values()].sort((a, b) => a.createdAt - b.createdAt);
    return {
      id: session.id,
      state: session.state,
      message: session.message,
      source: session.source,
      category: session.category,
      observed: session.observed,
      cwd: session.cwd ?? null,
      since: session.since,
      updatedAt: session.updatedAt,
      seq: session.seq,
      until: session.state === 'done' ? session.doneUntil : null,
      recentUntil: session.recentUntil ?? null,
      requests: requests.map(publicRequest),
      pendingRequests: requests.length,
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

  function pruneRecent(now) {
    let changed = false;
    for (const [key, completion] of recentCompletions) {
      if (now >= completion.until) {
        recentCompletions.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  function clearRecentFor(sessionId) {
    let changed = false;
    for (const [key, completion] of recentCompletions) {
      if (completion.sessionId === sessionId) {
        recentCompletions.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  function recordCompletion(session, event, now) {
    const at = Number.isFinite(event.completedAt) ? event.completedAt : now;
    const key = `${session.id}:${at}`;
    recentCompletions.set(key, {
      key,
      sessionId: session.id,
      source: session.source,
      message: clean(event.completionMessage) || session.message || 'turn finished',
      observed: session.observed,
      category: 'completion',
      at,
      until: at + recentHold,
    });
    session.recentUntil = at + recentHold;
    session.doneUntil = now + hold;
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
    if (pruneRecent(now)) changed = true;
    if (changed && sessions.size === 0) markIdle(now, lastSource);
    return changed;
  }

  function ordered() {
    return [...sessions.values()].sort((a, b) => {
      const left = a.requests.size ? 'needs-you' : a.state;
      const right = b.requests.size ? 'needs-you' : b.state;
      const priority = (SESSION_PRIORITY[right] ?? 0) - (SESSION_PRIORITY[left] ?? 0);
      return priority || b.seq - a.seq;
    });
  }

  function pendingList() {
    const list = [];
    for (const session of sessions.values()) {
      for (const request of session.requests.values()) {
        list.push({
          ...publicRequest(request),
          sessionId: session.id,
          source: session.source,
          cwd: session.cwd ?? null,
          state: 'needs-you',
        });
      }
    }
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }

  function recentList(now) {
    return [...recentCompletions.values()]
      .filter((completion) => completion.until > now)
      .sort((a, b) => b.at - a.at)
      .map((completion) => ({ ...completion }));
  }

  function snapshot(now = Date.now()) {
    settle(now);
    const active = ordered();
    const pendingRequests = pendingList();
    const recent = recentList(now);

    if (!active.length) {
      return {
        ...idle,
        category: 'idle',
        observed: 'explicit',
        sessionId: null,
        until: null,
        recentUntil: null,
        requests: [],
        pendingRequests: 0,
        pendingRequestsList: pendingRequests,
        recentCompletions: recent,
        lastIdleReminder,
        sessions: [],
        now,
      };
    }

    const top = active[0];
    const topRequests = [...top.requests.values()].sort((a, b) => a.createdAt - b.createdAt);
    const state = topRequests.length ? 'needs-you' : top.state;
    const message = topRequests.length ? topRequests[0].label : top.message;
    return {
      state,
      message,
      source: top.source,
      category: topRequests.length ? topRequests[0].kind : top.category,
      observed: top.observed,
      since: top.since,
      seq: top.seq,
      sessionId: top.id,
      until: state === 'done' ? top.doneUntil : null,
      recentUntil: top.recentUntil ?? null,
      requests: topRequests.map(publicRequest),
      pendingRequests: pendingRequests.length,
      pendingRequestsList: pendingRequests,
      recentCompletions: recent,
      lastIdleReminder,
      sessions: active.map(publicSession),
      now,
    };
  }

  function addRequest(session, request, now) {
    if (!request || typeof request !== 'object') return null;
    const kind = request.kind === 'question' ? 'question' : request.kind === 'permission' ? 'permission' : 'question';
    const id = requestIdFor(session.id, { ...request, kind });
    if (session.requests.has(id)) return session.requests.get(id);
    const entry = {
      id,
      kind,
      label:
        clean(request.label) ||
        (kind === 'permission' ? 'Claude needs permission' : 'Claude has a question'),
      toolName: clean(request.toolName, 60),
      decisionId: clean(request.decisionId, 96),
      createdAt: now,
    };
    session.requests.set(id, entry);
    while (session.requests.size > REQUEST_MAX) {
      const oldest = [...session.requests.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      session.requests.delete(oldest.id);
    }
    return entry;
  }

  function resolveRequests(session, event) {
    if (!session.requests.size) return 0;
    const explicit = [];
    if (Array.isArray(event.resolveRequests)) {
      for (const value of event.resolveRequests) if (value) explicit.push(String(value));
    }
    if (event.requestId) explicit.push(String(event.requestId));
    if (event.toolUseId) explicit.push(String(event.toolUseId));

    let resolved = 0;
    if (event.resolveAllRequests === true) {
      resolved = session.requests.size;
      session.requests.clear();
      return resolved;
    }

    if (explicit.length) {
      for (const request of [...session.requests.values()]) {
        if (explicit.includes(request.id) || (request.toolName && explicit.includes(request.toolName))) {
          session.requests.delete(request.id);
          resolved += 1;
        }
      }
      if (resolved) return resolved;
    }

    // A hook payload without a tool_use_id can still prove that a tool of the
    // same name ran. Match only requests that have no stable tool identity, so
    // a completion can never wipe an unrelated parallel request.
    const toolName = clean(event.toolName, 60);
    if (toolName) {
      for (const request of [...session.requests.values()]) {
        if (!request.toolName || request.toolName !== toolName) continue;
        if (/^fp-/.test(request.id) || request.toolName) {
          // Fingerprint-only requests are safe to match by tool name. Requests
          // carrying a tool_use_id are handled by the explicit id above.
          if (/^fp-/.test(request.id)) {
            session.requests.delete(request.id);
            resolved += 1;
          }
        }
      }
    }
    return resolved;
  }

  function dispatch(event, now = Date.now()) {
    const state = normalizeState(event.state);
    const id = sessionIdFor(event);
    const source = clean(event.source, 40) || null;
    const message = clean(event.message);
    const cwd = clean(event.cwd, 512);
    const category = normalizeCategory(event.category, event.observed === 'inferred' ? 'editing-inferred' : 'tool');
    const observed = event.observed === 'inferred' ? 'inferred' : 'explicit';
    const eventSeq = nextSeq();
    if (source) lastSource = source;

    if (event.informational === true && state === 'idle') {
      // An idle reminder is information, not a request. Keep the session and
      // its completion clock intact; expose the reminder separately.
      lastIdleReminder = {
        at: now,
        message: message || 'Claude is waiting for you',
        source,
        sessionId: id,
      };
      return snapshot(now);
    }

    if (state === 'idle') {
      const existing = sessions.get(id);
      if (event.resolveAllRequests === true || event.sessionEnded === true) {
        // An ended session invalidates its own outstanding requests; ordinary
        // idle events must never dismiss one.
        sessions.delete(id);
        clearRecentFor(id);
        if (sessions.size === 0) idle = { state: 'idle', message: null, source: source ?? lastSource, since: now, seq: eventSeq };
        return snapshot(now);
      }
      if (existing?.requests.size) {
        // A generic idle event must not dismiss an unresolved request.
        return snapshot(now);
      }
      sessions.delete(id);
      clearRecentFor(id);
      if (sessions.size === 0) {
        idle = {
          state: 'idle',
          message: null,
          source: source ?? lastSource,
          since: now,
          seq: eventSeq,
        };
      }
      return snapshot(now);
    }

    const newWork = state === 'thinking' || state === 'working' || state === 'needs-you' || state === 'error';
    if (newWork) clearRecentFor(id);

    const existing = sessions.get(id);
    const session = existing || {
      id,
      state,
      message: null,
      source,
      category,
      observed,
      cwd: cwd ?? null,
      since: now,
      updatedAt: now,
      seq: eventSeq,
      doneUntil: null,
      recentUntil: null,
      requests: new Map(),
    };

    session.state = state;
    session.message = message;
    session.source = source ?? session.source;
    if (cwd) session.cwd = cwd;
    session.category = category;
    session.observed = observed;
    session.updatedAt = now;
    session.seq = eventSeq;
    if (!existing) session.since = now;
    if (state !== 'done') session.doneUntil = null;

    if (event.request) addRequest(session, event.request, now);
    if (event.resolveRequests !== undefined || event.requestId || event.toolUseId) {
      resolveRequests(session, event);
    }
    if (event.request) {
      session.state = 'needs-you';
      session.category = event.request.kind === 'permission' ? 'permission' : 'question';
      const request = [...session.requests.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (request) session.message = request.label;
    }

    if (state === 'done') {
      session.requests.clear();
      if (event.interrupted === true) {
        session.state = 'idle';
        session.category = 'interrupted';
        session.message = message || 'turn interrupted';
        sessions.delete(id);
        if (sessions.size === 0) markIdle(now, source);
        return snapshot(now);
      }
      recordCompletion(session, event, now);
      session.message = message || 'turn finished';
      session.category = observed === 'inferred' ? category : 'completion';
      session.doneUntil = now + hold;
    }

    sessions.set(id, session);
    // A resolved request can leave the session as needs-you only when another
    // request is still open. Otherwise the incoming event's own state stands.
    if (session.requests.size) {
      session.state = 'needs-you';
      const request = [...session.requests.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      session.message = request.label;
      session.category = request.kind === 'permission' ? 'permission' : 'question';
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
    const pruned = pruneRecent(now);
    if (!expired && !pruned) return false;
    settle(now);
    return true;
  }

  function getSession(id) {
    const session = sessions.get(normalizeSessionId(id));
    return session ? publicSession(session) : null;
  }

  function dismiss(id, now = Date.now()) {
    const key = normalizeSessionId(id);
    const removed = sessions.delete(key);
    clearRecentFor(key);
    if (removed && sessions.size === 0) markIdle(now, lastSource);
    return { removed, snapshot: snapshot(now) };
  }

  return { dispatch, tick, snapshot, getSession, dismiss };
}
