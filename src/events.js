/**
 * Normalize Claude Code hook payloads into the activity events understood by
 * the session machine. This module is pure so every mapping can be tested
 * against the documented hook schema.
 */

export const CLAUDE_HOOK_EVENTS = Object.freeze([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'Stop',
  'SessionEnd',
]);

const TOOL_CATEGORIES = new Map([
  ['read', 'reading'],
  ['notebookread', 'reading'],
  ['grep', 'searching'],
  ['glob', 'searching'],
  ['websearch', 'searching'],
  ['webfetch', 'searching'],
  ['edit', 'editing'],
  ['write', 'editing'],
  ['multiedit', 'editing'],
  ['notebookedit', 'editing'],
  ['bash', 'running'],
  ['shell', 'running'],
  ['task', 'delegating'],
  ['agent', 'delegating'],
  ['todowrite', 'planning'],
  ['todo', 'planning'],
]);

function clean(value, max = 240) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\r\n\t]+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

export function categoryForTool(toolName) {
  const key = String(toolName || '').toLowerCase().replace(/[^a-z]/g, '');
  return TOOL_CATEGORIES.get(key) || 'tool';
}

function requestKind(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('permission')) return 'permission';
  if (value.includes('elicit') || value.includes('question')) return 'question';
  return 'question';
}

function requestLabel(payload, kind, tool) {
  const message = clean(payload.message);
  if (message) return message;
  return kind === 'permission' ? `Claude needs permission to use ${tool}` : 'Claude has a question for you';
}

function baseEvent(payload) {
  return {
    observed: 'explicit',
    sessionId: clean(payload.session_id || payload.sessionId, 96) || undefined,
    // Claude Code includes the session's working directory in every hook
    // payload. Buffy only uses it to open the folder from an activity card.
    cwd: clean(payload.cwd, 512) || undefined,
  };
}

/**
 * Map one hook event. Returning null means the event carries no visible state.
 * `PermissionRequest` and elicitation notifications create explicit requests;
 * ordinary PreToolUse does not, because Claude may run the tool without asking.
 */
export function mapClaudeHook(eventName, payload = {}) {
  const event = String(eventName || payload.hook_event_name || '').toLowerCase();
  const tool = clean(payload.tool_name || payload.toolName, 60) || 'a tool';
  const toolUseId = clean(payload.tool_use_id || payload.toolUseId, 120) || undefined;
  const common = baseEvent(payload);

  switch (event) {
    case 'sessionstart':
    case 'session-start':
      return {
        ...common,
        state: 'idle',
        informational: true,
        category: 'session-end',
        message: 'Claude session started',
      };
    case 'userpromptsubmit':
    case 'user-prompt-submit':
      return {
        ...common,
        state: 'thinking',
        message: 'thinking about your prompt',
        source: 'claude',
        category: 'thinking',
      };
    case 'pretooluse':
    case 'pre-tool-use':
      return {
        ...common,
        state: 'working',
        message: `using ${tool}`,
        source: 'claude',
        category: categoryForTool(tool),
        toolName: tool,
        toolUseId,
        resolveRequests: toolUseId ? [toolUseId] : undefined,
      };
    case 'permissionrequest':
    case 'permission-request': {
      const requestId = clean(payload.permission_request_id || payload.request_id, 120) || toolUseId;
      return {
        ...common,
        state: 'needs-you',
        message: requestLabel(payload, 'permission', tool),
        source: 'claude',
        category: 'permission',
        toolName: tool,
        toolUseId,
        request: {
          id: requestId,
          kind: 'permission',
          label: requestLabel(payload, 'permission', tool),
          toolName: tool,
          toolUseId,
        },
      };
    }
    case 'posttooluse':
    case 'post-tool-use':
      return {
        ...common,
        state: 'working',
        message: `${tool} finished`,
        source: 'claude',
        category: categoryForTool(tool),
        toolName: tool,
        toolUseId,
        resolveRequests: toolUseId ? [toolUseId] : undefined,
      };
    case 'posttoolusefailure':
    case 'post-tool-use-failure':
      return {
        ...common,
        state: 'error',
        message: clean(payload.error) || `${tool} failed`,
        source: 'claude',
        category: 'error',
        toolName: tool,
        toolUseId,
        resolveRequests: toolUseId ? [toolUseId] : undefined,
      };
    case 'notification': {
      const type = clean(payload.notification_type || payload.type, 60) || '';
      const message = clean(payload.message);
      if (type === 'idle_prompt' || type === 'idle') {
        return {
          ...common,
          state: 'idle',
          informational: true,
          category: 'idle-reminder',
          message: message || 'Claude has been waiting for you',
          source: 'claude',
        };
      }
      const kind = requestKind(type);
      const label = requestLabel({ ...payload, message }, kind, tool);
      return {
        ...common,
        state: 'needs-you',
        message: label,
        source: 'claude',
        category: kind,
        toolName: tool,
        toolUseId,
        request: {
          id: clean(payload.request_id, 120) || toolUseId,
          kind,
          label,
          toolName: tool,
          toolUseId,
        },
      };
    }
    case 'stop':
      return {
        ...common,
        state: 'done',
        message: 'turn finished',
        source: 'claude',
        category: 'completion',
        observed: 'explicit',
        interrupted: payload.is_interrupt === true || payload.interrupted === true,
        completionMessage: 'turn finished',
        toolName: undefined,
      };
    case 'subagentstop':
    case 'subagent-stop':
      return {
        ...common,
        state: 'working',
        message: `${clean(payload.agent_type, 40) || 'subagent'} finished`,
        source: 'claude',
        category: 'delegating',
      };
    case 'precompact':
    case 'pre-compact':
      return {
        ...common,
        state: 'working',
        message: 'compacting context',
        source: 'claude',
        category: 'compacting',
      };
    case 'postcompact':
    case 'post-compact':
      return {
        ...common,
        state: 'thinking',
        message: 'context compacted',
        source: 'claude',
        category: 'compacting',
      };
    case 'sessionend':
    case 'session-end':
      return {
        ...common,
        state: 'idle',
        message: clean(payload.reason) ? `session ended (${clean(payload.reason, 40)})` : 'session ended',
        source: 'claude',
        category: 'session-end',
        resolveAllRequests: true,
        sessionEnded: true,
      };
    default:
      return null;
  }
}

/** Kept as a named alias for callers that used the old hook module. */
export const mapClaudeEvent = mapClaudeHook;
