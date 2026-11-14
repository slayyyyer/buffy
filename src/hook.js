import crypto from 'node:crypto';
import fs from 'node:fs';

import { buffyFile, ensureBuffyDir, readConfig } from './config.js';
import { ensureDaemon, postEvent, sendCelebration } from './client.js';
import { explicitSuccess } from './celebrate.js';
import { mapAgentHook, mapClaudeHook, mapClaudeEvent } from './events.js';
import { loadPrefs } from './prefs.js';

export { mapAgentHook, mapClaudeHook, mapClaudeEvent };

const AGENTS = new Set(['claude', 'gemini', 'cursor']);
const DECISION_WAIT_MS = 8000;

function clean(value, max = 180) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\t]+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Every supported agent pipes a JSON payload on stdin. Never let a missing or
 * malformed payload hang or fail a hook: resolve with whatever arrived after a
 * short wait.
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

export function recordHookSeen(agent, event, payload, env, { delivered = false } = {}) {
  try {
    ensureBuffyDir(env);
    const record = {
      agent,
      at: new Date().toISOString(),
      event,
      // Whether the daemon actually received this event. A hook that ran but
      // could not deliver must not be recorded as a healthy connection.
      delivered: Boolean(delivered),
      sessionId: clean(
        payload.session_id || payload.conversation_id || payload.sessionId,
        80,
      ),
    };
    const text = `${JSON.stringify(record, null, 2)}\n`;
    fs.writeFileSync(buffyFile(`hook-last-${agent}.json`, env), text);
    // Keep the original Claude health file readable by older builds.
    if (agent === 'claude') fs.writeFileSync(buffyFile('hook-last.json', env), text);
  } catch {
    /* health reporting must never break the hook */
  }
}

/**
 * Gemini parses stdout as JSON and requires a silent, valid object. Cursor also
 * reads JSON from stdout, and a blocking hook that returns invalid JSON can
 * block the agent. Claude expects no stdout at all.
 */
function writeHookOutput(agent, eventName) {
  if (agent === 'gemini') {
    process.stdout.write('{}\n');
    return;
  }
  if (agent === 'cursor') {
    if (String(eventName || '').toLowerCase() === 'beforesubmitprompt') {
      process.stdout.write('{"continue":true}\n');
    } else {
      process.stdout.write('{}\n');
    }
  }
}

function permissionDecisionsEnabled(env) {
  try {
    return loadPrefs({ env }).permissions?.claudeDecisions === true;
  } catch {
    return false;
  }
}

/** Attach a one-shot decision id without trusting the hook payload for it. */
function attachDecision(mapped) {
  const decisionId = crypto.randomUUID();
  const request = mapped.request && typeof mapped.request === 'object' ? { ...mapped.request } : { kind: 'permission' };
  request.id = clean(request.id, 120) || decisionId;
  request.decisionId = decisionId;
  mapped.request = request;
  return { id: decisionId, requestId: request.id, timeoutMs: DECISION_WAIT_MS };
}

function writePermissionDecision(decision) {
  const behavior = decision?.behavior === 'allow' ? 'allow' : 'deny';
  const payload = {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior,
        ...(behavior === 'deny' ? { message: 'Denied from Buffy' } : {}),
      },
    },
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/**
 * Run one agent hook. Always exits 0: stderr is the only place for diagnostics,
 * so a broken daemon can never block the agent loop.
 */
export async function runAgentHook(agentName, eventName, { env = process.env } = {}) {
  const agent = AGENTS.has(String(agentName || '').toLowerCase())
    ? String(agentName).toLowerCase()
    : 'claude';
  const raw = await readHookInput();
  let payload = {};
  let malformed = false;
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch {
      // A corrupt payload must not invent a state. Stay silent and successful.
      payload = {};
      malformed = true;
    }
  }

  const event = eventName || payload.hook_event_name;
  if (malformed || !event) {
    writeHookOutput(agent, eventName || '');
    return 0;
  }

  const mapped = mapAgentHook(agent, event, payload);
  if (!mapped) {
    writeHookOutput(agent, event);
    return 0;
  }

  const sessionId = clean(mapped.sessionId, 80);
  const wantsDecision =
    agent === 'claude' &&
    String(event).toLowerCase() === 'permissionrequest' &&
    mapped.request &&
    permissionDecisionsEnabled(env);
  const config = readConfig(env);
  let delivered = false;
  try {
    const health = await ensureDaemon({ port: config.port, env, waitMs: 2500 });
    // Do not hold Claude's native prompt when nobody is watching the overlay.
    const decision =
      wantsDecision && health?.decisions === true && health?.overlayConnected === true
        ? attachDecision(mapped)
        : null;
    const { sessionId: _rawSession, ...rest } = mapped;
    const result = await postEvent(
      config.port,
      {
        ...rest,
        ...(sessionId ? { sessionId: `${agent}:${sessionId}` } : {}),
        ...(decision ? { decision } : {}),
      },
      decision ? { timeout: DECISION_WAIT_MS + 2000, full: true } : undefined,
    );
    delivered = true;
    if (decision && result?.decision?.behavior) {
      recordHookSeen(agent, event, payload, env, { delivered });
      writePermissionDecision(result.decision);
      return 0;
    }
    if (agent === 'claude') {
      const success = explicitSuccess(payload);
      if (success) await sendCelebration(config.port, success.message);
    }
  } catch (error) {
    process.stderr.write(`buffy hook: ${error.message}\n`);
  }
  recordHookSeen(agent, event, payload, env, { delivered });
  writeHookOutput(agent, event);
  return 0;
}

export function runClaudeHook(eventName, options = {}) {
  return runAgentHook('claude', eventName, options);
}
