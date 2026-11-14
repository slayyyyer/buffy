import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { mapAgentHook } from '../src/events.js';
import { hookInvocation, testHook } from '../src/connect-test.js';

/**
 * The connection check is only honest if its synthetic payloads are ones the
 * mapper actually accepts. If an agent's hook shape changes, this fails before
 * Settings ever reports a green check built on a payload nobody understands.
 */
test('every test event maps to a visible state', () => {
  const expected = { claude: 'working', gemini: 'working', cursor: 'thinking' };
  for (const agent of ['claude', 'gemini', 'cursor']) {
    const { event, payload } = testHook(agent, 'nonce-123');
    const mapped = mapAgentHook(agent, event, payload);
    assert.ok(mapped, `${agent} ${event} must map to a state`);
    assert.equal(mapped.state, expected[agent], `${agent} reports ${expected[agent]}`);
    const sessionId = mapped.sessionId;
    assert.equal(sessionId, 'nonce-123', `${agent} must carry the nonce as its session`);
  }
});

test('the hook runs from the checkout when nothing is packaged', () => {
  const invocation = hookInvocation('claude', 'PreToolUse', { packaged: false });
  assert.equal(invocation.via, 'checkout');
  assert.match(invocation.command, /(node|electron)/i);
  assert.deepEqual(invocation.args.slice(-3), ['hook', 'claude', 'PreToolUse']);
  assert.ok(path.isAbsolute(invocation.args[0]), 'the CLI entry point is an absolute path');
});

test('a packaged app with no launcher is told to repair, not tested', () => {
  const invocation = hookInvocation('claude', 'PreToolUse', {
    packaged: true,
    env: { BUFFY_HOME: path.join(process.cwd(), '.no-such-home') },
  });
  assert.equal(invocation.command, undefined, 'no command is invented');
  assert.match(invocation.error, /Repair the connection/);
});

test('an unknown agent falls back to the Claude shape', () => {
  assert.equal(testHook('nope', 'x').agent, 'claude');
  assert.equal(testHook('nope', 'x').event, 'PreToolUse');
});
