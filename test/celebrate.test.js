import test from 'node:test';
import assert from 'node:assert/strict';

import { explicitSuccess, testBuildKind } from '../src/celebrate.js';

test('recognizes test and build commands', () => {
  assert.equal(testBuildKind('npm test'), 'tests');
  assert.equal(testBuildKind('npm run test -- --watch=false'), 'tests');
  assert.equal(testBuildKind('pnpm build'), 'build');
  assert.equal(testBuildKind('cargo test'), 'tests');
  assert.equal(testBuildKind('cargo build'), 'build');
  assert.equal(testBuildKind('node --test'), 'tests');
  assert.equal(testBuildKind('tsc --noEmit'), 'build');
  assert.equal(testBuildKind('git status'), null);
  assert.equal(testBuildKind(''), null);
});

test('requires a Bash test/build command with an explicit zero exit code', () => {
  const base = {
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    tool_response: { exit_code: 0 },
  };
  assert.deepEqual(explicitSuccess(base), {
    kind: 'tests',
    command: 'npm test',
    message: 'tests passed',
  });
  assert.equal(explicitSuccess({ ...base, tool_response: { exitCode: 0 } }).message, 'tests passed');
  assert.equal(explicitSuccess({ ...base, tool_input: { command: 'npm run build' } }).message, 'build passed');

  assert.equal(explicitSuccess({ ...base, tool_response: { exit_code: 1 } }), null);
  assert.equal(explicitSuccess({ ...base, tool_response: { exit_code: '1' } }), null);
  assert.equal(explicitSuccess({ ...base, tool_response: { stdout: 'passed' } }), null);
  assert.equal(explicitSuccess({ ...base, tool_response: { exit_code: 0, interrupted: true } }), null);
  assert.equal(explicitSuccess({ ...base, tool_response: { exit_code: 0, is_error: true } }), null);
  assert.equal(explicitSuccess({ ...base, tool_name: 'Edit' }), null);
  assert.equal(explicitSuccess({ ...base, tool_input: { command: 'git status' } }), null);
  assert.equal(explicitSuccess({}), null);
});
