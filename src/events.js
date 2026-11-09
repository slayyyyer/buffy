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
  ['runshellcommand', 'running'],
  ['task', 'delegating'],
  ['agent', 'delegating'],
  ['delete', 'editing'],
  ['writefile', 'editing'],
  ['replace', 'editing'],
  ['readfile', 'reading'],
  ['readmanyfiles', 'reading'],
  ['listdirectory', 'reading'],
  ['grepsearch', 'searching'],
  ['searchfilecontent', 'searching'],
  ['googlewebsearch', 'searching'],
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

function agentCommon(payload, sessionKeys) {
  const session = sessionKeys.map((key) => payload[key]).find(Boolean);
  return {
    observed: 'explicit',
    sessionId: clean(session, 96) || undefined,
    cwd: clean(payload.cwd, 512) || undefined,
  };
}

/** Map one Gemini CLI hook payload onto the same activity vocabulary. */
export function mapGeminiHook(eventName, payload = {}) {
  const event = String(eventName || payload.hook_event_name || '').toLowerCase();
  const common = agentCommon(payload, ['session_id', 'sessionId']);
  const tool = clean(payload.tool_name || payload.toolName, 60) || 'a tool';

  switch (event) {
    case 'sessionstart':
      return {
        ...common,
        state: 'idle',
        informational: true,
        category: 'session-end',
        message: 'Gemini session started',
      };
    case 'beforeagent':
      return {
        ...common,
        state: 'thinking',
        message: 'thinking about your prompt',
        source: 'gemini',
        category: 'thinking',
      };
    case 'beforetool':
      return {
        ...common,
        state: 'working',
        message: `using ${tool}`,
        source: 'gemini',
        category: categoryForTool(tool),
        toolName: tool,
      };
    case 'aftertool': {
      const failed = Boolean(payload.tool_response?.error || payload.error);
      const error = clean(payload.tool_response?.error, 240) || clean(payload.error, 240);
      return {
        ...common,
        state: failed ? 'error' : 'working',
        message: failed ? error || `${tool} failed` : `${tool} finished`,
        source: 'gemini',
        category: failed ? 'error' : categoryForTool(tool),
        toolName: tool,
        // Gemini has no tool-use id in this event. The empty list still asks
        // the session machine to resolve a matching fingerprint by tool name.
        resolveRequests: [],
      };
    }
    case 'afteragent':
      return {
        ...common,
        state: 'done',
        message: 'turn finished',
        source: 'gemini',
        category: 'completion',
        observed: 'explicit',
        completionMessage: 'turn finished',
      };
    case 'notification': {
      const type = clean(payload.notification_type || payload.type, 60) || '';
      // Gemini only emits Notification for system alerts today; only a tool
      // permission alert is an actionable request. Everything else stays silent.
      if (!/permission/i.test(type)) return null;
      const details = payload.details && typeof payload.details === 'object' ? payload.details : {};
      const requestTool = clean(details.tool_name || payload.tool_name, 60) || 'a tool';
      const label = clean(payload.message) || `Gemini needs permission to use ${requestTool}`;
      return {
        ...common,
        state: 'needs-you',
        message: label,
        source: 'gemini',
        category: 'permission',
        toolName: requestTool,
        request: {
          id: clean(details.request_id || payload.request_id, 120),
          kind: 'permission',
          label,
          toolName: requestTool,
        },
      };
    }
    case 'precompress':
      return {
        ...common,
        state: 'working',
        message: 'compacting context',
        source: 'gemini',
        category: 'compacting',
      };
    case 'sessionend': {
      const reason = clean(payload.reason, 40);
      return {
        ...common,
        state: 'idle',
        message: reason ? `session ended (${reason})` : 'session ended',
        source: 'gemini',
        category: 'session-end',
        resolveAllRequests: true,
        sessionEnded: true,
      };
    }
    default:
      return null;
  }
}

/** Map one Cursor hook payload. Cursor has no reliable permission-request hook. */
export function mapCursorHook(eventName, payload = {}) {
  const event = String(eventName || payload.hook_event_name || '').toLowerCase();
  const common = agentCommon(payload, ['conversation_id', 'session_id']);
  if (!common.cwd && Array.isArray(payload.workspace_roots)) {
    common.cwd = clean(payload.workspace_roots[0], 512) || undefined;
  }
  const tool = clean(payload.tool_name || payload.toolName, 60) || 'a tool';
  const toolUseId = clean(payload.tool_use_id || payload.toolUseId, 120) || undefined;

  switch (event) {
    case 'sessionstart':
      return {
        ...common,
        state: 'idle',
        informational: true,
        category: 'session-end',
        message: 'Cursor session started',
      };
    case 'sessionend': {
      const reason = clean(payload.reason, 40);
      return {
        ...common,
        state: 'idle',
        message: reason ? `session ended (${reason})` : 'session ended',
        source: 'cursor',
        category: 'session-end',
        resolveAllRequests: true,
        sessionEnded: true,
      };
    }
    case 'beforesubmitprompt':
      return {
        ...common,
        state: 'thinking',
        message: 'thinking about your prompt',
        source: 'cursor',
        category: 'thinking',
      };
    case 'posttooluse':
      return {
        ...common,
        state: 'working',
        message: `${tool} finished`,
        source: 'cursor',
        category: categoryForTool(tool),
        toolName: tool,
        toolUseId,
        resolveRequests: toolUseId ? [toolUseId] : undefined,
      };
    case 'posttoolusefailure':
      return {
        ...common,
        state: 'error',
        message: clean(payload.error_message, 240) || `${tool} failed`,
        source: 'cursor',
        category: 'error',
        toolName: tool,
        toolUseId,
        resolveRequests: toolUseId ? [toolUseId] : undefined,
      };
    case 'afterfileedit': {
      const edited = clean(payload.file_path, 240);
      const file = edited ? edited.split(/[\\/]/).pop() : null;
      return {
        ...common,
        state: 'working',
        message: file ? `editing ${file}` : 'editing a file',
        source: 'cursor',
        category: 'editing',
      };
    }
    case 'aftershellexecution':
      return {
        ...common,
        state: 'working',
        message: 'command finished',
        source: 'cursor',
        category: 'running',
        toolName: 'Shell',
      };
    case 'precompact':
      return {
        ...common,
        state: 'working',
        message: 'compacting context',
        source: 'cursor',
        category: 'compacting',
      };
    case 'subagentstop': {
      const status = String(payload.status || '').toLowerCase();
      const label = clean(payload.subagent_type, 40) || 'subagent';
      return {
        ...common,
        state: status === 'error' ? 'error' : 'working',
        message: status === 'error' ? `${label} failed` : `${label} finished`,
        source: 'cursor',
        category: status === 'error' ? 'error' : 'delegating',
      };
    }
    case 'stop': {
      const status = String(payload.status || 'completed').toLowerCase();
      if (status === 'error') {
        return {
          ...common,
          state: 'error',
          message: 'turn failed',
          source: 'cursor',
          category: 'error',
        };
      }
      return {
        ...common,
        state: 'done',
        message: status === 'aborted' ? 'turn interrupted' : 'turn finished',
        source: 'cursor',
        category: 'completion',
        observed: 'explicit',
        interrupted: status === 'aborted',
        completionMessage: 'turn finished',
      };
    }
    default:
      return null;
  }
}

export function mapAgentHook(agent, eventName, payload = {}) {
  const key = String(agent || 'claude').toLowerCase();
  if (key === 'gemini') return mapGeminiHook(eventName, payload);
  if (key === 'cursor') return mapCursorHook(eventName, payload);
  return mapClaudeHook(eventName, payload);
}

/** Kept as a named alias for callers that used the old hook module. */
export const mapClaudeEvent = mapClaudeHook;
