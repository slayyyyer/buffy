import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentLauncherPath } from './install.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'buffy.js');

const AGENTS = new Set(['claude', 'gemini', 'cursor']);

/**
 * The event and payload shape each agent actually sends. Kept next to the
 * mapper's expectations so a real hook change breaks a test instead of quietly
 * breaking the connection check.
 */
export function testHook(agent, nonce = 'buffy-connect') {
  const id = String(nonce);
  switch (String(agent || '').toLowerCase()) {
    case 'gemini':
      return {
        agent: 'gemini',
        event: 'BeforeTool',
        payload: {
          session_id: id,
          hook_event_name: 'BeforeTool',
          tool_name: 'read_file',
          tool_input: { file_path: 'README.md' },
        },
      };
    case 'cursor':
      return {
        agent: 'cursor',
        event: 'beforeSubmitPrompt',
        payload: {
          conversation_id: id,
          hook_event_name: 'beforeSubmitPrompt',
          prompt: 'Buffy connection check',
        },
      };
    default:
      return {
        agent: 'claude',
        event: 'PreToolUse',
        payload: {
          session_id: id,
          hook_event_name: 'PreToolUse',
          tool_name: 'Read',
          tool_input: { file_path: 'README.md' },
        },
      };
  }
}

/**
 * Run the hook the way the agent does: through its installed launcher when there
 * is one, so a launcher left behind by an old install is what gets tested, not
 * the checkout.
 */
export function hookInvocation(agent, event, { env = process.env, packaged = false } = {}) {
  const launcher = agentLauncherPath(agent, env);
  if (packaged) {
    if (fs.existsSync(launcher)) return { command: launcher, args: [event], via: 'launcher', launcher };
    // Without the stable launcher there is nothing installed to test. Falling
    // back to a checkout would test a hook the agent never calls.
    return { error: 'The stable hook launcher is missing. Repair the connection first.', launcher };
  }
  return { command: process.execPath, args: [BIN, 'hook', agent, event], via: 'checkout', launcher };
}

function spawnHook({ command, args }, payload, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, error });
    };

    let child;
    try {
      if (process.platform === 'win32') {
        // A .cmd launcher needs a shell, and Node warns when an args array is
        // combined with one, so the command line is quoted here instead.
        const line = [command, ...args].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ');
        child = spawn(line, { shell: true, windowsHide: true });
      } else {
        child = spawn(command, args, { windowsHide: true });
      }
    } catch (error) {
      finish(null, error);
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish(null, new Error(`the hook did not exit within ${timeoutMs} ms`));
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code, null));
    child.stdin?.on('error', () => {
      /* the hook may never read stdin */
    });
    child.stdin?.end(`${JSON.stringify(payload)}\n`);
  });
}

async function daemonSaw(port, nonce, { fetchImpl, timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/state`;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) {
        const text = await response.text();
        if (text.includes(nonce)) return true;
      }
    } catch {
      /* the daemon may still be starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function dismiss(port, sessionId, fetchImpl) {
  try {
    await fetchImpl(`http://127.0.0.1:${port}/session/dismiss`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
  } catch {
    /* the check already succeeded; a leftover card is cosmetic */
  }
}

/**
 * Fire one synthetic event through the agent's own hook and report whether the
 * daemon observed it. This is the only check that proves the whole chain —
 * launcher, hook parsing, HTTP, state — instead of only that hooks are written.
 */
export async function runConnectionTest({
  agent = 'claude',
  env = process.env,
  packaged = false,
  port,
  fetchImpl = globalThis.fetch,
  timeoutMs = 12_000,
} = {}) {
  const key = AGENTS.has(String(agent || '').toLowerCase()) ? String(agent).toLowerCase() : 'claude';
  const nonce = `buffy-connect-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const { event, payload } = testHook(key, nonce);
  const invocation = hookInvocation(key, event, { env, packaged });
  if (invocation.error) {
    return {
      ok: false,
      observed: false,
      agent: key,
      event,
      via: 'none',
      command: null,
      launcher: invocation.launcher,
      ms: 0,
      exitCode: null,
      stdout: '',
      stderr: '',
      error: invocation.error,
    };
  }
  const started = Date.now();
  const run = await spawnHook(invocation, payload, timeoutMs);
  const observed = await daemonSaw(port, nonce, { fetchImpl });
  const ms = Date.now() - started;
  if (observed) await dismiss(port, `${key}:${nonce}`, fetchImpl);

  if (!observed) {
    return {
      ok: false,
      observed,
      agent: key,
      event,
      via: invocation.via,
      command: invocation.command,
      launcher: invocation.launcher,
      ms,
      exitCode: run.code,
      stdout: String(run.stdout || '').trim().slice(0, 400),
      stderr: String(run.stderr || '').trim().slice(0, 400),
      error: run.error
        ? `The hook could not run: ${run.error.message}`
        : run.code === 0
          ? 'The hook ran, but the daemon never saw the event. Reinstall the hooks.'
          : `The hook exited ${run.code} without reaching the daemon. Reinstall the hooks.`,
    };
  }

  return {
    ok: true,
    observed,
    agent: key,
    event,
    via: invocation.via,
    command: invocation.command,
    launcher: invocation.launcher,
    ms,
    exitCode: run.code,
    stdout: String(run.stdout || '').trim().slice(0, 400),
    stderr: String(run.stderr || '').trim().slice(0, 400),
    error: null,
  };
}
