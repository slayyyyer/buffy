import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buffyFile, ensureBuffyDir } from './config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BIN = path.resolve(HERE, '..', 'bin', 'buffy.js');
const BIN_POSIX = BIN.replace(/\\/g, '/');
const MARKER = 'buffy-managed';
const COMMAND_NAME = 'buffy';
const FREEBUFF_START = '<!-- buffy:start -->';
const FREEBUFF_END = '<!-- buffy:end -->';

/**
 * Claude Code hooks we install. PermissionRequest is the explicit permission
 * signal; Notification still carries idle prompts and elicitation questions.
 * Every entry is idempotent and owned by Buffy only when the command points at
 * Buffy's stable launcher or development CLI.
 */
export const CLAUDE_HOOKS = [
  { event: 'SessionStart' },
  { event: 'UserPromptSubmit' },
  { event: 'PreToolUse' },
  // PermissionRequest can wait briefly for an opt-in decision from the pet.
  { event: 'PermissionRequest', timeout: 20 },
  { event: 'PostToolUse' },
  { event: 'PostToolUseFailure' },
  {
    event: 'Notification',
    matcher: 'permission_prompt|idle_prompt|agent_needs_input|elicitation_dialog',
  },
  { event: 'PreCompact' },
  { event: 'PostCompact' },
  { event: 'SubagentStop' },
  { event: 'Stop' },
  { event: 'SessionEnd' },
];

/** Gemini CLI lifecycle events that map cleanly onto Buffy's state model. */
export const GEMINI_HOOKS = [
  { event: 'SessionStart' },
  { event: 'BeforeAgent' },
  { event: 'BeforeTool' },
  { event: 'AfterTool' },
  { event: 'AfterAgent' },
  { event: 'Notification' },
  { event: 'PreCompress' },
  { event: 'SessionEnd' },
];

/**
 * Cursor hooks are observational. Buffy deliberately does not install
 * preToolUse: it is a permission hook, and a status companion must not
 * auto-approve tool calls.
 */
export const CURSOR_HOOKS = [
  { event: 'sessionStart' },
  { event: 'sessionEnd' },
  { event: 'beforeSubmitPrompt' },
  { event: 'postToolUse' },
  { event: 'postToolUseFailure' },
  { event: 'afterFileEdit' },
  { event: 'afterShellExecution' },
  { event: 'preCompact' },
  { event: 'subagentStop' },
  { event: 'stop' },
];

function quote(value) {
  return `"${String(value).replace(/\\/g, '/')}"`;
}

export function cliPrefix() {
  return `${quote(process.execPath)} ${quote(BIN)}`;
}

export function launcherPath(env = process.env) {
  return agentLauncherPath('claude', env);
}

export function agentLauncherPath(agent = 'claude', env = process.env) {
  const suffixes = { claude: '', gemini: '-gemini', cursor: '-cursor' };
  const suffix = suffixes[agent] ?? `-${agent}`;
  const name = `buffy-hook${suffix}${process.platform === 'win32' ? '.cmd' : ''}`;
  return buffyFile(path.join('bin', name), env);
}

export function commandLauncherPath(env = process.env) {
  return buffyFile(path.join('bin', process.platform === 'win32' ? 'buffy-cli.cmd' : 'buffy-cli'), env);
}

function packagedHookEntry() {
  const unpacked = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'bin', 'buffy.js')
    : null;
  if (unpacked && fs.existsSync(unpacked)) return unpacked;
  return BIN;
}

/**
 * A stable launcher survives app updates and works when no system Node is
 * installed. It runs the packaged Electron binary in Node mode, then the CLI
 * hook command. The path never changes between versions.
 */
function writeLauncher(file, { entry, exe, args = '' }) {
  const rest = args ? ` ${args}` : '';
  let text;
  if (process.platform === 'win32') {
    text = [
      '@echo off',
      'rem buffy-hook-managed',
      'set "ELECTRON_RUN_AS_NODE=1"',
      `"${exe}" "${entry}"${rest} %*`,
      '',
    ].join('\r\n');
  } else {
    text = [
      '#!/bin/sh',
      '# buffy-hook-managed',
      `ELECTRON_RUN_AS_NODE=1 exec "${exe}" "${entry}"${rest} "$@"`,
      '',
    ].join('\n');
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, { mode: 0o755 });
    if (process.platform !== 'win32') fs.chmodSync(file, 0o755);
    return file;
  } catch {
    return null;
  }
}

export function ensureLauncher({ env = process.env, packaged = false, agent = 'claude' } = {}) {
  if (!packaged) return null;
  return writeLauncher(agentLauncherPath(agent, env), {
    entry: packagedHookEntry(),
    exe: process.execPath,
    args: `hook ${agent}`,
  });
}

/** The packaged `/buffy` command uses the same stable Node-mode launcher. */
export function ensureCommandLauncher({ env = process.env, packaged = false } = {}) {
  if (!packaged) return null;
  return writeLauncher(commandLauncherPath(env), {
    entry: packagedHookEntry(),
    exe: process.execPath,
  });
}

export function hookCommand(
  event,
  { env = process.env, packaged = false, launcher = null, agent = 'claude' } = {},
) {
  const stable = launcher || (packaged ? ensureLauncher({ env, packaged, agent }) : null);
  const command = stable
    ? `${quote(stable)} ${event}`
    : `${cliPrefix()} hook ${agent} ${event}`;
  // Cursor runs command hooks through PowerShell on Windows. A quoted path at
  // the start of a PowerShell command needs the call operator.
  return agent === 'cursor' && process.platform === 'win32' ? `& ${command}` : command;
}

export function claudePaths({ cwd = process.cwd(), global = false } = {}) {
  const base = global ? path.join(os.homedir(), '.claude') : path.join(cwd, '.claude');
  return {
    settings: path.join(base, 'settings.json'),
    command: path.join(base, 'commands', `${COMMAND_NAME}.md`),
  };
}

export function geminiPaths({ cwd = process.cwd(), global = false } = {}) {
  const base = global ? path.join(os.homedir(), '.gemini') : path.join(cwd, '.gemini');
  return { settings: path.join(base, 'settings.json') };
}

export function cursorPaths({ cwd = process.cwd(), global = false } = {}) {
  const base = global ? path.join(os.homedir(), '.cursor') : path.join(cwd, '.cursor');
  return { settings: path.join(base, 'hooks.json') };
}

function readSettings(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { text: '', data: {} };
    throw error;
  }
  if (!text.trim()) return { text, data: {} };
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return { text, data };
  } catch {
    throw new Error(`${file} is not a valid JSON object; refusing to modify it`);
  }
}

function commandOwnsAgent(command, agent, env) {
  if (typeof command !== 'string') return false;
  const normalized = command.replace(/\\/g, '/');
  const stable = agentLauncherPath(agent, env).replace(/\\/g, '/');
  if (normalized.includes(stable)) return true;
  return normalized.includes(BIN_POSIX) && new RegExp(`hook\\s+${agent}\\b`).test(command);
}

function isBuffyHook(entry, env, agent = 'claude') {
  const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
  return hooks.some((hook) => commandOwnsAgent(hook?.command, agent, env));
}

function isBuffyCursorEntry(entry, env) {
  return commandOwnsAgent(entry?.command, 'cursor', env);
}

/** Whether a settings object already contains Buffy's hooks for one agent. */
export function hasBuffyHooks(agent, data, env = process.env) {
  const hooks = data?.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks) ? data.hooks : {};
  return Object.values(hooks).some((list) => {
    if (!Array.isArray(list)) return false;
    return list.some((entry) =>
      agent === 'cursor' ? isBuffyCursorEntry(entry, env) : isBuffyHook(entry, env, agent),
    );
  });
}

function stamp(now) {
  return new Date(now).toISOString().replace(/[:.]/g, '-');
}

function backup(file, now) {
  let target = `${file}.buffy-backup-${stamp(now)}`;
  let index = 1;
  while (fs.existsSync(target)) {
    target = `${file}.buffy-backup-${stamp(now)}-${index}`;
    index += 1;
  }
  fs.copyFileSync(file, target);
  return target;
}

function writeAtomic(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.writeFileSync(temp, text, mode ? { mode } : undefined);
    try {
      fs.renameSync(temp, file);
    } catch (error) {
      if (process.platform !== 'win32') throw error;
      fs.rmSync(file, { force: true });
      fs.renameSync(temp, file);
    }
    if (mode) fs.chmodSync(file, mode);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function writeFile(file, text) {
  writeAtomic(file, text);
}

function manifestPath(env) {
  return buffyFile('installs.json', env);
}

function readManifest(env) {
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath(env), 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function recordInstall(entry, env) {
  try {
    const entries = readManifest(env).filter((item) => !(item.kind === entry.kind && item.scope === entry.scope));
    entries.push(entry);
    ensureBuffyDir(env);
    writeAtomic(manifestPath(env), `${JSON.stringify(entries, null, 2)}\n`);
  } catch {
    /* bookkeeping only */
  }
}

function forgetInstall(kind, scope, env) {
  try {
    const entries = readManifest(env).filter((item) => !(item.kind === kind && item.scope === scope));
    ensureBuffyDir(env);
    writeAtomic(manifestPath(env), `${JSON.stringify(entries, null, 2)}\n`);
  } catch {
    /* bookkeeping only */
  }
}

export function claudeCommandMarkdown(prefix = cliPrefix()) {
  return [
    '---',
    'description: Check in with buffy, pet her, or hatch a new sprite',
    'argument-hint: [status|pet|hatch <prompt>]',
    '---',
    '',
    `<!-- ${MARKER} -->`,
    'Run the CLI with this exact prefix:',
    '',
    '```',
    prefix,
    '```',
    '',
    'The text after the command name is: `$ARGUMENTS`',
    '',
    `- empty or \`status\` → \`${prefix} status\``,
    `- \`pet\` → \`${prefix} pet\``,
    `- \`hatch <prompt>\` or any other text → \`${prefix} hatch "<prompt>"\``,
    '',
    'Relay the output to the user. Add at most one short sentence; do not do anything else.',
    '',
  ].join('\n');
}

/**
 * Merge Buffy hooks into Claude Code settings without touching anything else.
 * Existing hooks for the same events are kept; our own entries are replaced so
 * repeated installs stay idempotent. Writes are atomic, and a failure while
 * writing the command file rolls the settings file back to its prior bytes.
 */
export function installClaude({
  cwd = process.cwd(),
  global = false,
  env = process.env,
  now = Date.now(),
  packaged = false,
} = {}) {
  const paths = claudePaths({ cwd, global });
  const scope = global ? 'user' : 'project';
  const result = {
    scope,
    settingsPath: paths.settings,
    commandPath: paths.command,
    backups: [],
    changed: [],
    notes: [],
    hooks: CLAUDE_HOOKS.map((hook) => hook.event),
    launcher: null,
    commandLauncher: null,
    skipped: false,
  };

  const { text, data } = readSettings(paths.settings);
  if (data.disableAllHooks === true) {
    result.skipped = true;
    result.notes.push('Claude Code has disableAllHooks enabled. Buffy left the settings untouched; enable hooks in Claude Code first.');
    return result;
  }

  const launcher = packaged ? ensureLauncher({ env, packaged }) : null;
  result.launcher = launcher;
  if (packaged && !launcher) {
    result.notes.push('The stable hook launcher could not be created; hooks may not run until this is fixed.');
  }

  const settings = { ...data };
  const existingHooks =
    settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks) ? settings.hooks : {};
  const hooks = { ...existingHooks };

  for (const { event, matcher, timeout = 10 } of CLAUDE_HOOKS) {
    const current = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = current.filter((entry) => !isBuffyHook(entry, env));
    const entry = {
      hooks: [{ type: 'command', command: hookCommand(event, { env, packaged, launcher }), timeout }],
    };
    if (matcher) entry.matcher = matcher;
    hooks[event] = [...kept, entry];
  }
  settings.hooks = hooks;

  const nextSettings = `${JSON.stringify(settings, null, 2)}\n`;
  if (nextSettings !== text) {
    if (text.trim()) result.backups.push(backup(paths.settings, now));
    writeFile(paths.settings, nextSettings);
    result.changed.push(paths.settings);
  }

  const commandPrefix = packaged
    ? ensureCommandLauncher({ env, packaged }) || cliPrefix()
    : cliPrefix();
  if (packaged) result.commandLauncher = commandLauncherPath(env);
  const commandText = claudeCommandMarkdown(commandPrefix);
  let previousCommand = '';
  try {
    previousCommand = fs.readFileSync(paths.command, 'utf8');
  } catch {
    /* new command file */
  }
  if (previousCommand !== commandText) {
    try {
      if (previousCommand.trim()) result.backups.push(backup(paths.command, now));
      writeFile(paths.command, commandText);
      result.changed.push(paths.command);
    } catch (error) {
      if (result.changed.includes(paths.settings)) {
        if (text) writeFile(paths.settings, text);
        else fs.rmSync(paths.settings, { force: true });
      }
      throw new Error(`could not write ${paths.command}: ${error.message}; Claude settings were restored`);
    }
  }

  recordInstall(
    {
      kind: 'claude',
      scope,
      settings: paths.settings,
      command: paths.command,
      launcher,
      backups: result.backups,
      installedAt: new Date(now).toISOString(),
    },
    env,
  );

  if (global) result.notes.push('user scope applies to every Claude Code project on this machine');
  if (launcher) result.notes.push(`stable launcher: ${launcher}`);  result.notes.push('Hooks run silently and never block Claude Code; if Buffy is unavailable the hook exits 0.');
  return result;
}

export function uninstallClaude({ cwd = process.cwd(), global = false, env = process.env } = {}) {
  const paths = claudePaths({ cwd, global });
  const scope = global ? 'user' : 'project';
  const result = {
    scope,
    settingsPath: paths.settings,
    commandPath: paths.command,
    removedHooks: 0,
    removedCommand: false,
    changed: [],
    notes: [],
  };

  if (fs.existsSync(paths.settings)) {
    const { text, data } = readSettings(paths.settings);
    if (data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks)) {
      const hooks = { ...data.hooks };
      for (const event of Object.keys(hooks)) {
        const list = Array.isArray(hooks[event]) ? hooks[event] : [];
        const kept = list.filter((entry) => !isBuffyHook(entry, env));
        result.removedHooks += list.length - kept.length;
        if (kept.length) hooks[event] = kept;
        else delete hooks[event];
      }
      data.hooks = hooks;
      if (!Object.keys(hooks).length) delete data.hooks;

      const nextSettings = `${JSON.stringify(data, null, 2)}\n`;
      if (nextSettings !== text) {
        writeFile(paths.settings, nextSettings);
        result.changed.push(paths.settings);
      }
    }
  }

  if (fs.existsSync(paths.command)) {
    const text = fs.readFileSync(paths.command, 'utf8');
    if (text.includes(MARKER)) {
      fs.rmSync(paths.command);
      result.removedCommand = true;
      result.changed.push(paths.command);
    } else {
      result.notes.push(`left ${paths.command} alone because it is not buffy-managed`);
    }
  }

  forgetInstall('claude', scope, env);
  return result;
}

/**
 * Merge Buffy's hook groups into Gemini CLI settings. Gemini keeps hooks in
 * the same settings.json as the rest of its configuration, so every unrelated
 * key and existing hook group is preserved.
 */
export function installGemini({
  cwd = process.cwd(),
  global = false,
  env = process.env,
  now = Date.now(),
  packaged = false,
} = {}) {
  const paths = geminiPaths({ cwd, global });
  const scope = global ? 'user' : 'project';
  const result = {
    agent: 'gemini',
    scope,
    settingsPath: paths.settings,
    backups: [],
    changed: [],
    notes: [],
    hooks: GEMINI_HOOKS.map((hook) => hook.event),
    launcher: null,
    skipped: false,
  };

  const { text, data } = readSettings(paths.settings);
  if (data.hooksConfig?.enabled === false) {
    result.skipped = true;
    result.notes.push('Gemini CLI hooks are disabled. Buffy left the settings untouched; enable hooks in Gemini CLI first.');
    return result;
  }

  const launcher = packaged ? ensureLauncher({ env, packaged, agent: 'gemini' }) : null;
  result.launcher = launcher;
  if (packaged && !launcher) {
    result.notes.push('The stable Gemini launcher could not be created; hooks may not run until this is fixed.');
  }

  const settings = { ...data };
  const existingHooks =
    settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks) ? settings.hooks : {};
  const hooks = { ...existingHooks };

  for (const { event } of GEMINI_HOOKS) {
    const current = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = current.filter((entry) => !isBuffyHook(entry, env, 'gemini'));
    hooks[event] = [
      ...kept,
      {
        hooks: [
          {
            name: 'buffy',
            type: 'command',
            command: hookCommand(event, { env, packaged, launcher, agent: 'gemini' }),
            timeout: 10_000,
            description: 'Mirror this Gemini CLI session in Buffy',
          },
        ],
      },
    ];
  }
  settings.hooks = hooks;

  const nextSettings = `${JSON.stringify(settings, null, 2)}\n`;
  if (nextSettings !== text) {
    if (text.trim()) result.backups.push(backup(paths.settings, now));
    writeFile(paths.settings, nextSettings);
    result.changed.push(paths.settings);
  }

  recordInstall(
    {
      kind: 'gemini',
      scope,
      settings: paths.settings,
      launcher,
      backups: result.backups,
      installedAt: new Date(now).toISOString(),
    },
    env,
  );

  if (global) result.notes.push('user scope applies to every Gemini CLI project on this machine');
  if (launcher) result.notes.push(`stable launcher: ${launcher}`);
  result.notes.push('Gemini hooks write an empty JSON object and never block the agent.');
  return result;
}

export function uninstallGemini({ cwd = process.cwd(), global = false, env = process.env } = {}) {
  const paths = geminiPaths({ cwd, global });
  const scope = global ? 'user' : 'project';
  const result = {
    agent: 'gemini',
    scope,
    settingsPath: paths.settings,
    removedHooks: 0,
    changed: [],
    notes: [],
  };

  if (fs.existsSync(paths.settings)) {
    const { text, data } = readSettings(paths.settings);
    if (data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks)) {
      const hooks = { ...data.hooks };
      for (const event of Object.keys(hooks)) {
        const list = Array.isArray(hooks[event]) ? hooks[event] : [];
        const kept = list.filter((entry) => !isBuffyHook(entry, env, 'gemini'));
        result.removedHooks += list.length - kept.length;
        if (kept.length) hooks[event] = kept;
        else delete hooks[event];
      }
      data.hooks = hooks;
      if (!Object.keys(hooks).length) delete data.hooks;

      const nextSettings = `${JSON.stringify(data, null, 2)}\n`;
      if (nextSettings !== text) {
        writeFile(paths.settings, nextSettings);
        result.changed.push(paths.settings);
      }
    }
  }

  forgetInstall('gemini', scope, env);
  return result;
}

/** Merge Buffy's observational hooks into Cursor's hooks.json. */
export function installCursor({
  cwd = process.cwd(),
  global = false,
  env = process.env,
  now = Date.now(),
  packaged = false,
} = {}) {
  const paths = cursorPaths({ cwd, global });
  const scope = global ? 'user' : 'project';
  const result = {
    agent: 'cursor',
    scope,
    settingsPath: paths.settings,
    backups: [],
    changed: [],
    notes: [],
    hooks: CURSOR_HOOKS.map((hook) => hook.event),
    launcher: null,
    skipped: false,
  };

  const { text, data } = readSettings(paths.settings);
  const launcher = packaged ? ensureLauncher({ env, packaged, agent: 'cursor' }) : null;
  result.launcher = launcher;
  if (packaged && !launcher) {
    result.notes.push('The stable Cursor launcher could not be created; hooks may not run until this is fixed.');
  }

  const settings = { ...data };
  settings.version = Number.isInteger(data.version) && data.version > 0 ? data.version : 1;
  const existingHooks =
    settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks) ? settings.hooks : {};
  const hooks = { ...existingHooks };

  for (const { event } of CURSOR_HOOKS) {
    const current = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = current.filter((entry) => !isBuffyCursorEntry(entry, env));
    hooks[event] = [
      ...kept,
      {
        command: hookCommand(event, { env, packaged, launcher, agent: 'cursor' }),
        timeout: 10,
      },
    ];
  }
  settings.hooks = hooks;

  const nextSettings = `${JSON.stringify(settings, null, 2)}\n`;
  if (nextSettings !== text) {
    if (text.trim()) result.backups.push(backup(paths.settings, now));
    writeFile(paths.settings, nextSettings);
    result.changed.push(paths.settings);
  }

  recordInstall(
    {
      kind: 'cursor',
      scope,
      settings: paths.settings,
      launcher,
      backups: result.backups,
      installedAt: new Date(now).toISOString(),
    },
    env,
  );

  if (global) result.notes.push('user scope applies to every Cursor workspace on this machine');
  if (launcher) result.notes.push(`stable launcher: ${launcher}`);
  result.notes.push('Buffy does not install Cursor preToolUse, so it never approves or blocks a tool call.');
  return result;
}

export function uninstallCursor({ cwd = process.cwd(), global = false, env = process.env } = {}) {
  const paths = cursorPaths({ cwd, global });
  const scope = global ? 'user' : 'project';
  const result = {
    agent: 'cursor',
    scope,
    settingsPath: paths.settings,
    removedHooks: 0,
    changed: [],
    notes: [],
  };

  if (fs.existsSync(paths.settings)) {
    const { text, data } = readSettings(paths.settings);
    if (data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks)) {
      const hooks = { ...data.hooks };
      for (const event of Object.keys(hooks)) {
        const list = Array.isArray(hooks[event]) ? hooks[event] : [];
        const kept = list.filter((entry) => !isBuffyCursorEntry(entry, env));
        result.removedHooks += list.length - kept.length;
        if (kept.length) hooks[event] = kept;
        else delete hooks[event];
      }
      data.hooks = hooks;
      if (!Object.keys(hooks).length) delete data.hooks;

      const nextSettings = `${JSON.stringify(data, null, 2)}\n`;
      if (nextSettings !== text) {
        writeFile(paths.settings, nextSettings);
        result.changed.push(paths.settings);
      }
    }
  }

  forgetInstall('cursor', scope, env);
  return result;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function managedBlockPattern() {
  return new RegExp(`${escapeRegExp(FREEBUFF_START)}[\\s\\S]*?${escapeRegExp(FREEBUFF_END)}`);
}

export function freebuffPaths({ cwd = process.cwd() } = {}) {
  return { agents: path.join(cwd, 'AGENTS.md') };
}

/** Instructions appended to AGENTS.md; Freebuff reads that file as knowledge. */
export function freebuffInstructions() {
  const prefix = cliPrefix();
  return [
    FREEBUFF_START,
    '## buffy companion',
    '',
    'A small desktop pet named buffy mirrors this session. These event commands are silent, return immediately, and are required at the checkpoints below. Run each one with the shell tool.',
    '',
    `- **As your first action, before planning:** \`${prefix} event thinking --source freebuff\``,
    `- **Before each file edit or project-changing tool call:** \`${prefix} event working --source freebuff --msg "what you are doing"\``,
    `- **Only after a test or build command exited 0 and you saw the passing result:** \`${prefix} celebrate "tests passed"\``,
    `- **Before you stop because you need the user's approval or input:** \`${prefix} event needs-you --source freebuff --msg "what you need"\``,
    `- **Before you stop after completing the task:** \`${prefix} event done --source freebuff\``,
    '',
    'End every turn with exactly one of `needs-you` or `done`. Do not skip `done` because the task was small. The repo watcher detects file edits, but it cannot report your reasoning, questions, or completion; these commands are the only way the pet learns those states.',
    '',
    'If a buffy command fails, continue the task and do not wait for it. Never mention buffy in your replies.',
    FREEBUFF_END,
  ].join('\n');
}

function upsertManagedBlock(file, block, now) {
  let existing = '';
  try {
    existing = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const pattern = managedBlockPattern();
  const trimmed = existing.replace(/\s+$/, '');
  const next = pattern.test(existing)
    ? existing.replace(pattern, () => block)
    : trimmed
      ? `${trimmed}\n\n${block}\n`
      : `${block}\n`;

  if (next === existing) return { changed: false, backups: [] };

  const backups = [];
  if (existing.trim()) backups.push(backup(file, now));
  writeFile(file, next);
  return { changed: true, backups };
}

function removeManagedBlock(file) {
  if (!fs.existsSync(file)) return { changed: false, removed: false, removedFile: false };

  const existing = fs.readFileSync(file, 'utf8');
  const pattern = managedBlockPattern();
  if (!pattern.test(existing)) return { changed: false, removed: false, removedFile: false };

  const next = existing.replace(pattern, '').replace(/\s+$/, '');
  if (!next.trim()) {
    fs.rmSync(file);
    return { changed: true, removed: true, removedFile: true };
  }

  writeFile(file, `${next}\n`);
  return { changed: true, removed: true, removedFile: false };
}

/** Add buffy's instructions to a project's AGENTS.md without clobbering it. */
export function installFreebuff({ cwd = process.cwd(), env = process.env, now = Date.now() } = {}) {
  const paths = freebuffPaths({ cwd });
  const update = upsertManagedBlock(paths.agents, freebuffInstructions(), now);
  const result = {
    scope: 'project',
    agentsPath: paths.agents,
    backups: update.backups,
    changed: update.changed ? [paths.agents] : [],
    notes: ['Freebuff reads AGENTS.md as a knowledge file; its events are best-effort. The repo watcher is the dependable signal.'],
  };

  recordInstall(
    {
      kind: 'freebuff',
      scope: 'project',
      agents: paths.agents,
      backups: update.backups,
      installedAt: new Date(now).toISOString(),
    },
    env,
  );

  return result;
}

/** Remove only the marked buffy block; user content stays untouched. */
export function uninstallFreebuff({ cwd = process.cwd(), env = process.env } = {}) {
  const paths = freebuffPaths({ cwd });
  const removal = removeManagedBlock(paths.agents);
  const result = {
    scope: 'project',
    agentsPath: paths.agents,
    removed: removal.removed,
    removedFile: removal.removedFile,
    changed: removal.changed ? [paths.agents] : [],
    notes: [],
  };

  if (!removal.removed) result.notes.push('AGENTS.md has no buffy block');
  forgetInstall('freebuff', 'project', env);
  return result;
}
