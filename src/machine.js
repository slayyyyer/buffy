import { STATES } from './config.js';

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

/**
 * Pure-ish state machine. `done` holds for doneHoldMs and falls back to idle;
 * every other state waits for the next event (needs-you is sticky by design).
 */
export function createMachine({ doneHoldMs = 4000 } = {}) {
  const hold = Math.max(0, doneHoldMs);
  let current = { state: 'idle', message: null, source: null, since: Date.now(), seq: 0 };
  let doneUntil = null;

  function dispatch(event, now = Date.now()) {
    const state = normalizeState(event.state);
    current = {
      state,
      message: event.message ? String(event.message).slice(0, 240) : null,
      source: event.source ? String(event.source).slice(0, 40) : null,
      since: now,
      seq: current.seq + 1,
    };
    doneUntil = state === 'done' ? now + hold : null;
    return current;
  }

  function tick(now = Date.now()) {
    if (current.state === 'done' && doneUntil !== null && now >= doneUntil) {
      current = { state: 'idle', message: null, source: current.source, since: now, seq: current.seq + 1 };
      doneUntil = null;
      return true;
    }
    return false;
  }

  function snapshot(now = Date.now()) {
    return { ...current, until: current.state === 'done' ? doneUntil : null, now };
  }

  return { dispatch, tick, snapshot };
}
