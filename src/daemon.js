import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buffyDir, buffyFile, ensureBuffyDir, readConfig, VERSION, STATES } from './config.js';
import { createFreebuffAdapter, FREEBUFF_SESSION_ID, freebuffProjectsRoot } from './freebuff.js';
import { createMachine, normalizeState } from './machine.js';
import { applyIdleDecay, createState, levelFromXp, loadState, saveState, clamp } from './state.js';
import { claudeProjectsRoot, createTranscriptAdapter } from './transcript.js';
import { createWatcher } from './watcher.js';

const MOOD = { idle: 0, thinking: 0, working: 0, 'needs-you': -3, done: 3, error: -6 };
const XP = { idle: 0, thinking: 1, working: 1, 'needs-you': 1, done: 6, error: 1 };

function cleanText(value, max = 240) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\t]+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

function readJsonBody(req, callback) {
  let size = 0;
  let done = false;
  const chunks = [];
  const finish = (err, value) => {
    if (done) return;
    done = true;
    callback(err, value);
  };
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > 64 * 1024) {
      finish(Object.assign(new Error('request body too large'), { status: 413 }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (!chunks.length) return finish(null, {});
    try {
      finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      finish(Object.assign(new Error('invalid JSON body'), { status: 400 }));
    }
  });
  req.on('error', (err) => finish(err));
}

/**
 * In-memory runtime (state machine, event history) on top of the persisted companion.
 * Everything is loopback-only. Each event belongs to a session and the visible
 * state is the most urgent active session, so concurrent agents cannot stomp
 * one another. The source travels with the event for the bubble.
 */
export function createDaemon({ config = readConfig(), env = process.env } = {}) {
  ensureBuffyDir(env);
  const store = loadState(env) || createState({});
  applyIdleDecay(store, Date.now());
  store.counters.sessions += 1;

  const machine = createMachine({
    doneHoldMs: config.doneHoldMs,
    sessionTtlMs: config.sessionTtlMs,
    livenessMs: config.livenessMs,
  });
  const clients = new Set();
  const decisions = new Map();
  // This token is written only to the user's runtime file. It keeps a browser
  // or other origin from answering a permission request through the loopback
  // HTTP server. Every decision is still scoped to one live request id.
  const controlToken = crypto.randomBytes(32).toString('hex');
  const startedAt = Date.now();
  let reaction = null;
  let celebration = null;
  let lastDispatchAt = 0;
  let lastDispatchState = null;
  let lastDispatchSession = null;
  let server = null;
  let watcher = null;
  let freebuffAdapter = null;
  let transcriptAdapter = null;
  let adapters = {
    freebuff: { enabled: config.freebuff?.enabled !== false, available: false, reason: 'starting' },
    claudeTranscript: { enabled: config.claudeTranscript?.enabled !== false, available: false, reason: 'starting' },
  };
  let watchInfo = {
    enabled: false,
    directory: null,
    quietMs: config.watch?.quietMs ?? null,
    pollMs: config.watch?.pollMs ?? null,
    git: false,
  };

  function withDecision(request) {
    if (!request) return request;
    return {
      ...request,
      decisionId: request.decisionId && decisions.has(request.decisionId) ? request.decisionId : null,
    };
  }

  function decorateSnapshot(current) {
    return {
      ...current,
      requests: (current.requests || []).map(withDecision),
      pendingRequestsList: (current.pendingRequestsList || []).map(withDecision),
      sessions: (current.sessions || []).map((session) => ({
        ...session,
        requests: (session.requests || []).map(withDecision),
      })),
    };
  }

  function snapshot(now = Date.now()) {
    const current = decorateSnapshot(machine.snapshot(now));
    return {
      version: VERSION,
      online: true,
      pid: process.pid,
      port: server?.address()?.port ?? null,
      startedAt,
      companion: store.companion,
      xp: store.xp,
      level: levelFromXp(store.xp),
      mood: Math.round(store.mood),
      current,
      sessions: current.sessions,
      pendingRequests: current.pendingRequests ?? 0,
      pendingRequestsList: current.pendingRequestsList ?? [],
      recentCompletions: current.recentCompletions ?? [],
      lastIdleReminder: current.lastIdleReminder ?? null,
      reaction: reaction && now - reaction.at < 10_000 ? reaction : null,
      celebration: celebration && now - celebration.at < 8_000 ? celebration : null,
      watch: watchInfo,
      adapters,
    };
  }

  function broadcast() {
    const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  }

  function dispatch(input, now = Date.now()) {
    const state = normalizeState(input.state);
    const source = cleanText(input.source, 40) || 'manual';
    const sessionId = cleanText(input.sessionId ?? input.session, 96) || source;
    const previous = machine.snapshot(now);
    const current = machine.dispatch(
      {
        ...input,
        state,
        message: cleanText(input.message),
        source,
        sessionId,
        cwd: input.cwd,
        category: input.category,
        observed: input.observed,
        request: input.request,
        resolveRequests: input.resolveRequests,
        resolveAllRequests: input.resolveAllRequests,
        requestId: input.requestId,
        toolUseId: input.toolUseId,
        toolName: input.toolName,
        informational: input.informational,
        interrupted: input.interrupted,
        completionMessage: input.completionMessage,
        completedAt: input.completedAt,
      },
      now,
    );

    const repeated =
      previous.state === state &&
      lastDispatchState === state &&
      lastDispatchSession === sessionId &&
      now - lastDispatchAt < 800;
    if (!repeated) {
      store.xp += XP[state] ?? 0;
      store.mood = clamp(store.mood + (MOOD[state] ?? 0), 0, 100);
    }
    store.counters.events += 1;
    store.lastSeen = new Date(now).toISOString();
    lastDispatchAt = now;
    lastDispatchState = state;
    lastDispatchSession = sessionId;

    saveState(store, env);
    broadcast();
    return current;
  }

  function controlAuthorized(req) {
    if (req.headers.origin) return false;
    const supplied = req.headers['x-buffy-control'];
    if (typeof supplied !== 'string' || supplied.length !== controlToken.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(controlToken));
    } catch {
      return false;
    }
  }

  function finishDecision(waiter, behavior, reason = null) {
    if (!waiter || waiter.done) return false;
    waiter.done = true;
    clearTimeout(waiter.timer);
    decisions.delete(waiter.id);

    if (behavior && waiter.requestId) {
      try {
        dispatch({
          state: 'working',
          message: behavior === 'allow' ? 'permission allowed' : 'permission denied',
          source: waiter.source,
          sessionId: waiter.sessionId,
          category: 'permission',
          resolveRequests: [waiter.requestId],
        });
      } catch {
        broadcast();
      }
    } else {
      broadcast();
    }

    if (!waiter.res.writableEnded) {
      try {
        sendJson(waiter.res, 200, {
          ok: true,
          decision: behavior ? { behavior } : null,
          reason,
        });
      } catch {
        /* the hook may have already timed out */
      }
    }
    return true;
  }

  function waitForDecision(decision, current, res) {
    const id = cleanText(decision?.id, 96);
    if (!id || !/^[A-Za-z0-9_-]{16,96}$/.test(id) || decisions.has(id) || clients.size === 0) {
      return false;
    }
    const request = (current.pendingRequestsList || []).find((entry) => entry.decisionId === id);
    if (!request) return false;

    const requested = Number(decision.timeoutMs);
    const timeoutMs = Number.isFinite(requested)
      ? Math.min(15_000, Math.max(500, Math.round(requested)))
      : 8000;
    const waiter = {
      id,
      requestId: request.id,
      sessionId: request.sessionId,
      source: request.source || 'claude',
      res,
      done: false,
      timer: null,
    };
    decisions.set(id, waiter);
    waiter.timer = setTimeout(() => finishDecision(waiter, null, 'timeout'), timeoutMs);
    res.on('close', () => {
      if (!res.writableEnded) finishDecision(waiter, null, 'client-closed');
    });
    // The first broadcast happened before the waiter existed. Send another so
    // the activity card can reveal its Allow/Deny actions immediately.
    broadcast();
    return true;
  }

  function dismissSession(input, now = Date.now()) {
    const id = cleanText(input?.sessionId ?? input?.session ?? input?.id, 96);
    if (!id) return { removed: false, snapshot: snapshot(now) };
    const result = machine.dismiss(id, now);
    if (result.removed) broadcast();
    return result;
  }

  function hello(now = Date.now()) {
    reaction = { kind: 'hello', at: now };
    store.xp += 2;
    store.mood = clamp(store.mood + 8, 0, 100);
    store.counters.hellos += 1;
    store.lastSeen = new Date(now).toISOString();
    saveState(store, env);
    broadcast();
    return snapshot(now);
  }

  // Celebration is deliberately explicit: a caller has to assert the pass.
  // The watcher never calls this, so file churn can never fake a green build.
  function celebrate(input, now = Date.now()) {
    const message = cleanText(input?.message, 120) || 'all green';
    celebration = { kind: 'celebrate', at: now, message };
    store.xp += 4;
    store.mood = clamp(store.mood + 6, 0, 100);
    store.counters.celebrations = (store.counters.celebrations || 0) + 1;
    store.lastSeen = new Date(now).toISOString();
    saveState(store, env);
    broadcast();
    return snapshot(now);
  }

  function spriteRoot() {
    return path.join(buffyDir(env), 'sprites');
  }

  function validSprite(candidate) {
    if (!candidate || typeof candidate !== 'object' || candidate.type !== 'image' || typeof candidate.file !== 'string') {
      return null;
    }
    const root = path.resolve(spriteRoot());
    const file = path.resolve(candidate.file);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) return null;
    try {
      if (!fs.statSync(file).isFile()) return null;
    } catch {
      return null;
    }
    return {
      type: 'image',
      id: cleanText(candidate.id, 80) || path.basename(file),
      file,
      prompt: cleanText(candidate.prompt, 1000),
      model: cleanText(candidate.model, 80),
      createdAt: cleanText(candidate.createdAt, 40),
    };
  }

  /**
   * The Freebuff signal: edits keep Buffy working, then a quiet window ends
   * the turn. It never overrides an unanswered needs-you alert, and it only
   * settles a state that the watcher itself set.
   */
  /**
   * A pushed event from the agent itself beats anything an adapter infers, for
   * a short grace window. Both Freebuff sources share one session, so the
   * stronger signal simply keeps the session rather than adding a duplicate.
   * An unanswered question is never overridden at all.
   */
  function explicitSessionFresh(sessionId, graceMs, selfSource = null) {
    const session = machine.getSession(sessionId);
    if (!session) return false;
    // An adapter must never yield to its own last event, or it would go quiet
    // for the whole grace window after every update it makes.
    if (selfSource && session.source === selfSource) return false;
    if (session.state === 'needs-you') return true;
    if (session.observed !== 'explicit') return false;
    const at = Number(session.updatedAt) || 0;
    return Date.now() - at < Math.max(0, Number(graceMs) || 0);
  }

  /**
   * The two evidence adapters. Neither can celebrate, resolve a request, or
   * write anything: they only read a local file and report what it says.
   */
  function startAdapters() {
    const freebuffConfig = config.freebuff || {};
    if (freebuffConfig.enabled !== false) {
      freebuffAdapter = createFreebuffAdapter({
        root: freebuffProjectsRoot(env),
        pollMs: freebuffConfig.pollMs,
        idlePollMs: freebuffConfig.idlePollMs,
        staleMs: freebuffConfig.staleMs,
        maxProjects: freebuffConfig.maxProjects,
        now: Date.now,
        shouldYield: () =>
          explicitSessionFresh(FREEBUFF_SESSION_ID, freebuffConfig.explicitGraceMs, 'freebuff-db'),
        onEvent: (event) => {
          try {
            dispatch({ ...event, source: 'freebuff-db', sessionId: FREEBUFF_SESSION_ID });
          } catch {
            /* a malformed row must not stop the daemon */
          }
        },
        onInfo: (next) => {
          adapters = { ...adapters, freebuff: next };
        },
      });
      adapters = { ...adapters, freebuff: freebuffAdapter.state() };
      void freebuffAdapter.start();
    } else {
      adapters = { ...adapters, freebuff: { enabled: false, available: false, reason: 'disabled' } };
    }

    const transcriptConfig = config.claudeTranscript || {};
    if (transcriptConfig.enabled !== false) {
      transcriptAdapter = createTranscriptAdapter({
        root: claudeProjectsRoot(env),
        pollMs: transcriptConfig.pollMs,
        activeMs: transcriptConfig.activeMs,
        stuckMs: transcriptConfig.stuckMs,
        doneWindowMs: transcriptConfig.doneWindowMs,
        now: Date.now,
        shouldYield: (event) =>
          explicitSessionFresh(event.sessionId, transcriptConfig.explicitGraceMs),
        onEvent: (event) => {
          try {
            dispatch({ ...event, source: 'claude-transcript' });
          } catch {
            /* a malformed transcript must not stop the daemon */
          }
        },
        onInfo: (next) => {
          adapters = { ...adapters, claudeTranscript: next };
        },
      });
      adapters = { ...adapters, claudeTranscript: transcriptAdapter.state() };
      void transcriptAdapter.start();
    } else {
      adapters = { ...adapters, claudeTranscript: { enabled: false, available: false, reason: 'disabled' } };
    }
  }

  function startWatch() {
    const watchConfig = config.watch || {};
    if (watchConfig.enabled === false) {
      watchInfo = { ...watchInfo, enabled: false, reason: 'disabled' };
      return;
    }

    const configured = typeof watchConfig.directory === 'string' ? watchConfig.directory.trim() : '';
    const directory = path.resolve(configured || process.cwd());
    if (directory === os.homedir() || directory === path.parse(directory).root) {
      watchInfo = { ...watchInfo, enabled: false, directory, reason: 'refusing to watch home or root' };
      return;
    }
    try {
      if (!fs.statSync(directory).isDirectory()) throw new Error('not a directory');
    } catch {
      watchInfo = { ...watchInfo, enabled: false, directory, reason: 'directory not found' };
      return;
    }

    watcher = createWatcher({
      directory,
      quietMs: watchConfig.quietMs,
      pollMs: watchConfig.pollMs,
      ignore: watchConfig.ignore,
      onWorking: ({ file }) => {
        dispatch({
          state: 'working',
          message: file ? `editing ${file}` : `watching ${path.basename(directory)}`,
          source: 'watcher',
          sessionId: 'watcher',
          category: 'editing-inferred',
          observed: 'inferred',
        });
      },
      onQuiet: () => {
        const watcherSession = machine.getSession('watcher');
        if (!watcherSession || watcherSession.state !== 'working') return;
        dispatch({
          state: 'done',
          message: 'activity settled',
          source: 'watcher',
          sessionId: 'watcher',
          category: 'settled-inferred',
          observed: 'inferred',
          completionMessage: 'Repository activity settled; no test result was observed.',
        });
      },
      onError: (error) => {
        watchInfo = { ...watchInfo, degraded: true, error: cleanText(error?.message, 80) };
      },
    });
    watcher.start();
    watchInfo = {
      enabled: true,
      directory,
      quietMs: watcher.quietMs,
      pollMs: watcher.pollMs,
      git: watcher.git,
    };
  }

  const doneTimer = setInterval(() => {
    if (machine.tick(Date.now())) broadcast();
  }, 200);
  doneTimer.unref?.();

  server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, x-buffy-source, x-buffy-session',
        'access-control-max-age': '600',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'buffy',
        version: VERSION,
        pid: process.pid,
        port: server.address()?.port ?? null,
        states: STATES,
        doneHoldMs: config.doneHoldMs,
        livenessMs: config.livenessMs,
        watch: watchInfo,
        adapters,
        pendingRequests: snapshot().pendingRequests ?? 0,
        decisions: true,
        overlayConnected: clients.size > 0,
      });
    }

    if (req.method === 'GET' && url.pathname === '/sprite') {
      const sprite = validSprite(store.companion.sprite);
      if (!sprite) return sendJson(res, 404, { ok: false, error: 'no sprite' });
      let bytes;
      try {
        bytes = fs.readFileSync(sprite.file);
      } catch {
        return sendJson(res, 404, { ok: false, error: 'sprite file missing' });
      }
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': bytes.length,
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      res.end(bytes);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/state') {
      return sendJson(res, 200, snapshot());
    }

    if (req.method === 'POST' && url.pathname === '/session/dismiss') {
      readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, err.status || 400, { ok: false, error: err.message });
        try {
          const result = dismissSession({
            sessionId: body?.sessionId ?? body?.session ?? body?.id,
          });
          sendJson(res, 200, { ok: true, removed: result.removed, state: snapshot() });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/permission/decision') {
      if (!controlAuthorized(req)) {
        return sendJson(res, 403, { ok: false, error: 'permission decision is not authorized' });
      }
      readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, err.status || 400, { ok: false, error: err.message });
        const id = cleanText(body?.id, 96);
        const behavior = body?.behavior === 'allow' ? 'allow' : body?.behavior === 'deny' ? 'deny' : null;
        if (!id || !behavior) {
          return sendJson(res, 400, { ok: false, error: 'a decision id and allow/deny behavior are required' });
        }
        const waiter = decisions.get(id);
        if (!waiter) {
          return sendJson(res, 409, { ok: false, error: 'that permission request is no longer waiting' });
        }
        finishDecision(waiter, behavior, 'user');
        return sendJson(res, 200, { ok: true, decision: { behavior }, state: snapshot() });
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'access-control-allow-origin': '*',
      });
      res.write('retry: 1000\n\n');
      res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* next close cleans up */
        }
      }, 15_000);
      ping.unref?.();
      // Track the response lifetime, not the GET request stream: the request
      // stream can close while the SSE response is still live.
      res.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && (url.pathname === '/event' || url.pathname === '/events')) {
      readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, err.status || 400, { ok: false, error: err.message });
        try {
          const headerSession = req.headers['x-buffy-session'];
          const sessionId =
            body.sessionId ??
            body.session ??
            (Array.isArray(headerSession) ? headerSession[0] : headerSession);
          const current = dispatch({
            ...body,
            sessionId,
            source: body.source || req.headers['x-buffy-source'],
          });
          if (body.decision && waitForDecision(body.decision, current, res)) return;
          sendJson(res, 200, { ok: true, current, state: snapshot() });
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error.message });
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/sprite') {
      readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, err.status || 400, { ok: false, error: err.message });
        const sprite = validSprite(body?.sprite);
        if (!sprite) return sendJson(res, 400, { ok: false, error: 'invalid sprite' });
        store.companion.sprite = sprite;
        store.lastSeen = new Date().toISOString();
        saveState(store, env);
        broadcast();
        sendJson(res, 200, { ok: true, sprite, state: snapshot() });
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/hello') {
      const state = hello();
      return sendJson(res, 200, { ok: true, state });
    }

    if (req.method === 'POST' && url.pathname === '/celebrate') {
      readJsonBody(req, (err, body) => {
        if (err) return sendJson(res, err.status || 400, { ok: false, error: err.message });
        return sendJson(res, 200, { ok: true, state: celebrate(body) });
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  });

  async function listen(port) {
    await new Promise((resolve, reject) => {
      const onError = (err) => {
        server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
    startWatch();
    startAdapters();
    return server.address().port;
  }

  async function close() {
    for (const waiter of decisions.values()) {
      clearTimeout(waiter.timer);
      if (!waiter.res.writableEnded) {
        try {
          waiter.res.end();
        } catch {
          /* already closed */
        }
      }
    }
    decisions.clear();
    const currentWatcher = watcher;
    watcher = null;
    await currentWatcher?.close();
    freebuffAdapter?.close();
    freebuffAdapter = null;
    transcriptAdapter?.close();
    transcriptAdapter = null;
    clearInterval(doneTimer);
    for (const res of clients) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    clients.clear();
    await new Promise((resolve) => server.close(resolve));
    try {
      const runtime = JSON.parse(fs.readFileSync(buffyFile('runtime.json', env), 'utf8'));
      if (runtime.pid === process.pid) fs.rmSync(buffyFile('runtime.json', env), { force: true });
    } catch {
      /* nothing to clean up */
    }
  }

  return {
    listen,
    close,
    snapshot,
    dispatch,
    dismissSession,
    hello,
    celebrate,
    machine,
    server,
    store,
    controlToken,
    decisions,
  };
}

export async function startDaemon({ config = readConfig(), env = process.env, port = config.port, quiet = false } = {}) {
  ensureBuffyDir(env);
  const daemon = createDaemon({ config, env });
  const actualPort = await daemon.listen(port);
  const runtime = {
    pid: process.pid,
    port: actualPort,
    startedAt: new Date().toISOString(),
    version: VERSION,
    controlToken: daemon.controlToken,
  };
  const runtimeFile = buffyFile('runtime.json', env);
  fs.writeFileSync(runtimeFile, `${JSON.stringify(runtime, null, 2)}\n`);
  try {
    fs.chmodSync(runtimeFile, 0o600);
  } catch {
    /* Windows and some filesystems do not expose POSIX modes */
  }
  if (!quiet) {
    process.stderr.write(`buffy daemon: http://127.0.0.1:${actualPort} (state: ${buffyFile('state.json', env)})\n`);
  }
  return { ...daemon, port: actualPort };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = readConfig();
  startDaemon({ config, quiet: Boolean(process.env.BUFFY_QUIET) })
    .then(({ port, close }) => {
      const shutdown = () => {
        close().finally(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      process.stdout.write(`buffy daemon listening on 127.0.0.1:${port}\n`);
    })
    .catch((error) => {
      process.stderr.write(`buffy daemon: ${error.message}\n`);
      process.exit(error.code === 'EADDRINUSE' ? 0 : 1);
    });
}
