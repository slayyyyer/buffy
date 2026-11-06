import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buffyDir, buffyFile, ensureBuffyDir, readConfig, VERSION, STATES } from './config.js';
import { createMachine, normalizeState } from './machine.js';
import { applyIdleDecay, createState, levelFromXp, loadState, saveState, clamp } from './state.js';
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
 * In-memory runtime (state machine, event history) on top of the persisted pet.
 * Everything is loopback-only. Each event belongs to a session and the visible
 * state is the most urgent active session, so concurrent agents cannot stomp
 * one another. The source travels with the event for the bubble.
 */
export function createDaemon({ config = readConfig(), env = process.env } = {}) {
  ensureBuffyDir(env);
  const store = loadState(env) || createState({});
  applyIdleDecay(store, Date.now());
  store.counters.sessions += 1;

  const machine = createMachine({ doneHoldMs: config.doneHoldMs, sessionTtlMs: config.sessionTtlMs });
  const clients = new Set();
  const startedAt = Date.now();
  let reaction = null;
  let lastDispatchAt = 0;
  let lastDispatchState = null;
  let lastDispatchSession = null;
  let server = null;
  let watcher = null;
  let watchInfo = {
    enabled: false,
    directory: null,
    quietMs: config.watch?.quietMs ?? null,
    pollMs: config.watch?.pollMs ?? null,
    git: false,
  };

  function snapshot(now = Date.now()) {
    const current = machine.snapshot(now);
    return {
      version: VERSION,
      online: true,
      pid: process.pid,
      port: server?.address()?.port ?? null,
      startedAt,
      pet: store.pet,
      xp: store.xp,
      level: levelFromXp(store.xp),
      mood: Math.round(store.mood),
      current,
      sessions: current.sessions,
      reaction: reaction && now - reaction.at < 10_000 ? reaction : null,
      watch: watchInfo,
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
    const current = machine.dispatch({ state, message: cleanText(input.message), source, sessionId }, now);

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

  function dismissSession(input, now = Date.now()) {
    const id = cleanText(input?.sessionId ?? input?.session ?? input?.id, 96);
    if (!id) return { removed: false, snapshot: snapshot(now) };
    const result = machine.dismiss(id, now);
    if (result.removed) broadcast();
    return result;
  }

  function pet(now = Date.now()) {
    reaction = { kind: 'pet', at: now };
    store.xp += 2;
    store.mood = clamp(store.mood + 8, 0, 100);
    store.counters.pets += 1;
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
   * The Freebuff signal: edits keep the pet working, then a quiet window ends
   * the turn. It never overrides an unanswered needs-you alert, and it only
   * settles a state that the watcher itself set.
   */
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
        });
      },
      onQuiet: () => {
        const watcherSession = machine.getSession('watcher');
        if (!watcherSession || watcherSession.state !== 'working') return;
        dispatch({ state: 'done', message: 'changes settled', source: 'watcher', sessionId: 'watcher' });
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
      });
    }

    if (req.method === 'GET' && url.pathname === '/sprite') {
      const sprite = validSprite(store.pet.sprite);
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
      req.on('close', () => {
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
        store.pet.sprite = sprite;
        store.lastSeen = new Date().toISOString();
        saveState(store, env);
        broadcast();
        sendJson(res, 200, { ok: true, sprite, state: snapshot() });
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/pet') {
      const state = pet();
      return sendJson(res, 200, { ok: true, state });
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
    return server.address().port;
  }

  async function close() {
    const currentWatcher = watcher;
    watcher = null;
    await currentWatcher?.close();
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

  return { listen, close, snapshot, dispatch, dismissSession, pet, machine, server, store };
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
  };
  fs.writeFileSync(buffyFile('runtime.json', env), `${JSON.stringify(runtime, null, 2)}\n`);
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
