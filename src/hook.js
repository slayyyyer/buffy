import fs from 'node:fs';

import { buffyFile, ensureBuffyDir, readConfig } from './config.js';
import { ensureDaemon, postEvent, sendCelebration } from './client.js';
import { explicitSuccess } from './celebrate.js';
import { mapClaudeHook, mapClaudeEvent } from './events.js';

export { mapClaudeHook, mapClaudeEvent };

function clean(value, max = 180) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\t]+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Claude Code pipes a JSON payload on stdin. Never let a missing or malformed
 * payload hang or fail a hook: resolve with whatever arrived after a short wait.
 */
export function readHookInput({ timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }

    let data = '';
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.pause();
      resolve(value);
    };

    const onData = (chunk) => {
      data += chunk;
      if (data.length >= 64 * 1024) finish(data);
    };
    const onEnd = () => finish(data);
    const timer = setTimeout(() => finish(data), timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onData);
    process.stdin.on('end', onEnd);
    process.stdin.resume();
  });
}

function recordHookSeen(event, payload, env) {
  try {
    ensureBuffyDir(env);
    fs.writeFileSync(
      buffyFile('hook-last.json', env),
      `${JSON.stringify(
        {
          at: new Date().toISOString(),
          event,
          sessionId: clean(payload.session_id || payload.sessionId, 80),
        },
        null,
        2,
      )}\n`,
    );
  } catch {
    /* health reporting must never break the hook */
  }
}

/**
 * Run one Claude Code hook. Always exits 0 with no stdout: stderr is the only
 * place for diagnostics, so a broken daemon can never block the agent loop.
 */
export async function runClaudeHook(eventName, { env = process.env } = {}) {
  const raw = await readHookInput();
  let payload = {};
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
  }

  const event = eventName || payload.hook_event_name;
  const mapped = mapClaudeHook(event, payload);
  if (!mapped) return 0;

  const sessionId = clean(mapped.sessionId, 80);
  const { sessionId: _rawSession, ...rest } = mapped;
  const config = readConfig(env);
  try {
    await ensureDaemon({ port: config.port, env, waitMs: 2500 });
    await postEvent(config.port, {
      ...rest,
      ...(sessionId ? { sessionId: `claude:${sessionId}` } : {}),
    });
    recordHookSeen(event, payload, env);
    const success = explicitSuccess(payload);
    if (success) await sendCelebration(config.port, success.message);
  } catch (error) {
    process.stderr.write(`buffy hook: ${error.message}\n`);
  }
  return 0;
}
