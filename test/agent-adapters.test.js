import test from 'node:test';
import assert from 'node:assert/strict';

import { mapAgentHook, mapCursorHook, mapGeminiHook } from '../src/events.js';

test('Gemini lifecycle hooks map onto states, categories, and sessions', () => {
  const start = mapGeminiHook('SessionStart', { session_id: 'g1', cwd: 'C:/work/app' });
  assert.equal(start.state, 'idle');
  assert.equal(start.informational, true);
  assert.equal(start.sessionId, 'g1');
  assert.equal(start.cwd, 'C:/work/app');

  const prompt = mapGeminiHook('BeforeAgent', { session_id: 'g1' });
  assert.equal(prompt.state, 'thinking');
  assert.equal(prompt.source, 'gemini');
  assert.equal(prompt.category, 'thinking');

  const tool = mapGeminiHook('BeforeTool', {
    session_id: 'g1',
    tool_name: 'run_shell_command',
  });
  assert.equal(tool.state, 'working');
  assert.equal(tool.category, 'running');
  assert.equal(tool.message, 'using run_shell_command');

  const after = mapGeminiHook('AfterTool', {
    session_id: 'g1',
    tool_name: 'read_file',
    tool_response: {},
  });
  assert.equal(after.state, 'working');
  assert.equal(after.category, 'reading');
  assert.deepEqual(after.resolveRequests, []);

  assert.equal(mapGeminiHook('AfterAgent', { session_id: 'g1' }).state, 'done');
  assert.equal(mapGeminiHook('PreCompress', {}).category, 'compacting');
  assert.equal(mapGeminiHook('SessionEnd', { reason: 'exit' }).resolveAllRequests, true);
  assert.equal(mapGeminiHook('SessionEnd', {}).sessionEnded, true);
  assert.equal(mapGeminiHook('SomethingElse', {}), null);
});

test('Gemini permission alerts are explicit requests and matching tools resolve them', () => {
  const permission = mapGeminiHook('Notification', {
    session_id: 'g2',
    notification_type: 'ToolPermission',
    message: 'Allow Gemini to run npm test?',
    details: { tool_name: 'run_shell_command' },
  });
  assert.equal(permission.state, 'needs-you');
  assert.equal(permission.category, 'permission');
  assert.equal(permission.request.kind, 'permission');
  assert.equal(permission.request.toolName, 'run_shell_command');

  const failure = mapGeminiHook('AfterTool', {
    session_id: 'g2',
    tool_name: 'run_shell_command',
    tool_response: { error: 'permission denied' },
  });
  assert.equal(failure.state, 'error');
  assert.equal(failure.message, 'permission denied');

  assert.equal(
    mapGeminiHook('Notification', { notification_type: 'Warning', message: 'heads up' }),
    null,
  );
  assert.equal(mapAgentHook('gemini', 'BeforeAgent', {}).source, 'gemini');
});

test('Cursor hooks map sessions, tools, edits, failures, and completion honestly', () => {
  const start = mapCursorHook('sessionStart', {
    session_id: 'c1',
    conversation_id: 'c1',
    workspace_roots: ['/work/app'],
  });
  assert.equal(start.state, 'idle');
  assert.equal(start.sessionId, 'c1');
  assert.equal(start.cwd, '/work/app');

  const prompt = mapCursorHook('beforeSubmitPrompt', {
    conversation_id: 'c1',
    prompt: 'fix the tests',
  });
  assert.equal(prompt.state, 'thinking');
  assert.equal(prompt.source, 'cursor');

  const post = mapCursorHook('postToolUse', {
    conversation_id: 'c1',
    tool_name: 'Shell',
    tool_use_id: 'tool-1',
  });
  assert.equal(post.state, 'working');
  assert.equal(post.category, 'running');
  assert.deepEqual(post.resolveRequests, ['tool-1']);

  const edited = mapCursorHook('afterFileEdit', {
    conversation_id: 'c1',
    file_path: 'C:/work/app/src/app.ts',
  });
  assert.equal(edited.message, 'editing app.ts');
  assert.equal(edited.category, 'editing');

  const failed = mapCursorHook('postToolUseFailure', {
    conversation_id: 'c1',
    tool_name: 'Shell',
    error_message: 'Command timed out',
  });
  assert.equal(failed.state, 'error');
  assert.equal(failed.message, 'Command timed out');

  const done = mapCursorHook('stop', { conversation_id: 'c1', status: 'completed' });
  assert.equal(done.state, 'done');

  const aborted = mapCursorHook('stop', { conversation_id: 'c1', status: 'aborted' });
  assert.equal(aborted.interrupted, true);

  const errored = mapCursorHook('stop', { conversation_id: 'c1', status: 'error' });
  assert.equal(errored.state, 'error');

  const ended = mapCursorHook('sessionEnd', { conversation_id: 'c1', reason: 'completed' });
  assert.equal(ended.sessionEnded, true);
  assert.equal(ended.resolveAllRequests, true);
  assert.equal(mapCursorHook('SomethingElse', {}), null);
});
