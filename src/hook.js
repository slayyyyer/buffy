import { readConfig } from './config.js';
import { ensureDaemon, postEvent } from './client.js';

function clean(value, max = 180) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\t]+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Pure mapping from a Claude Code hook event (plus its stdin payload) to the
 * state buffy should show. Kept separate so it is easy to test.
 */
export function mapClaudeHook(eventName, payload = {}) {
  const event = String(eventName || payload.hook_event_name || '').toLowerCase();
  const tool = clean(payload.tool_name || payload.toolName, 40) || 'a tool';

  switch (event) {
    case 'userpromptsubmit':
    case 'user-prompt-submit':
      return { state: 'thinking', message: 'thinking about your prompt', source: 'claude' };
    case 'pretooluse':
    case 'pre-tool-use':
      return { state: 'working', message: `using ${tool}`, source: 'claude' };
    case 'posttooluse':
    case 'post-tool-use':
      return { state: 'working', message: `${tool} finished`, source: 'claude' };
    case 'notification': {
      const type = clean(payload.notification_type, 40);
      const message = clean(payload.message) || `Claude needs you${type ? ` (${type})` : ''}`;
      return { state: 'needs-you', message, source: 'claude' };
    }
    case 'stop':
      return { state: 'done', message: 'turn finished', source: 'claude' };
    default:
      return null;
  }
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

  const config = readConfig(env);
  try {
    await ensureDaemon({ port: config.port, env, waitMs: 2500 });
    await postEvent(config.port, mapped);
  } catch (error) {
    process.stderr.write(`buffy hook: ${error.message}\n`);
  }
  return 0;
}
