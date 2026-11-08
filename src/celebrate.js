/**
 * Celebration is the one optimistic state in Buffy, so it needs a real signal.
 * A caller must either run `buffy celebrate` itself or hand us a tool response
 * that explicitly says the process exited 0. File churn and "tool finished"
 * are deliberately not enough.
 */

const TEST_OR_BUILD =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|tests|ci|build)\b|\b(?:jest|vitest|pytest|mocha|ava|tap)\b|\bnode\s+--test\b|\b(?:go|cargo|dotnet)\s+(?:test|build)\b|\b(?:mvn|gradle|make)(?:\s|$)|\btsc\b|\beslint\b/i;

const TEST_WORD = /\b(?:test|tests|jest|vitest|pytest|mocha|ava|tap)\b/i;

/** Classify a shell command as a test run, a build, or neither. */
export function testBuildKind(command) {
  const text = String(command || '').trim();
  if (!text || !TEST_OR_BUILD.test(text)) return null;
  return TEST_WORD.test(text) ? 'tests' : 'build';
}

/**
 * Read only the explicit signals a Claude PostToolUse payload can carry. The
 * documented tool_response shape is tool-specific and often has no exit code,
 * in which case this returns null and nothing celebrates.
 */
export function explicitSuccess(payload = {}) {
  if (String(payload?.tool_name || '').toLowerCase() !== 'bash') return null;
  const command = payload?.tool_input?.command;
  const kind = testBuildKind(command);
  if (!kind) return null;

  const response = payload?.tool_response;
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  if (response.interrupted === true || response.is_error === true) return null;

  const code = Number(response.exit_code ?? response.exitCode);
  if (!Number.isInteger(code) || code !== 0) return null;

  return {
    kind,
    command,
    message: kind === 'tests' ? 'tests passed' : 'build passed',
  };
}
