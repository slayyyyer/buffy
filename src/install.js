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
 * The five Claude Code hooks we care about. Notification is filtered to the
 * types that actually want a human; Stop is a per-turn event.
 */
export const CLAUDE_HOOKS = [
  { event: 'UserPromptSubmit' },
  { event: 'PreToolUse' },
  { event: 'PostToolUse' },
  {
    event: 'Notification',
    matcher: 'permission_prompt|idle_prompt|agent_needs_input|elicitation_dialog',
  },
  { event: 'Stop' },
];

function quote(value) {
  return `"${String(value).replace(/\\/g, '/')}"`;
}

export function cliPrefix() {
  return `${quote(process.execPath)} ${quote(BIN)}`;
}

export function hookCommand(event) {
  return `${cliPrefix()} hook claude ${event}`;
}

export function claudePaths({ cwd = process.cwd(), global = false } = {}) {
  const base = global ? path.join(os.homedir(), '.claude') : path.join(cwd, '.claude');
  return {
    settings: path.join(base, 'settings.json'),
    command: path.join(base, 'commands', `${COMMAND_NAME}.md`),
  };
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

function isBuffyHook(entry) {
  const hooks = Array.isArray(entry?.hooks) ? entry.hooks : [];
  return hooks.some(
    (hook) =>
      typeof hook?.command === 'string' &&
      hook.command.replace(/\\/g, '/').includes(BIN_POSIX) &&
      /hook\s+claude\b/.test(hook.command),
  );
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

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
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
    fs.writeFileSync(manifestPath(env), `${JSON.stringify(entries, null, 2)}\n`);
  } catch {
    /* bookkeeping only */
  }
}

function forgetInstall(kind, scope, env) {
  try {
    const entries = readManifest(env).filter((item) => !(item.kind === kind && item.scope === scope));
    ensureBuffyDir(env);
    fs.writeFileSync(manifestPath(env), `${JSON.stringify(entries, null, 2)}\n`);
  } catch {
    /* bookkeeping only */
  }
}

export function claudeCommandMarkdown() {
  const prefix = cliPrefix();
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
 * Merge buffy hooks into Claude Code settings without touching anything else.
 * Existing hooks for the same events are kept; our own entries are replaced so
 * repeated installs stay idempotent.
 */
export function installClaude({ cwd = process.cwd(), global = false, env = process.env, now = Date.now() } = {}) {
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
  };

  const { text, data } = readSettings(paths.settings);
  const settings = { ...data };
  const existingHooks =
    settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks) ? settings.hooks : {};
  const hooks = { ...existingHooks };

  for (const { event, matcher } of CLAUDE_HOOKS) {
    const current = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = current.filter((entry) => !isBuffyHook(entry));
    const entry = {
      hooks: [{ type: 'command', command: hookCommand(event), timeout: 10 }],
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

  const commandText = claudeCommandMarkdown();
  let previousCommand = '';
  try {
    previousCommand = fs.readFileSync(paths.command, 'utf8');
  } catch {
    /* new command file */
  }
  if (previousCommand !== commandText) {
    if (previousCommand.trim()) result.backups.push(backup(paths.command, now));
    writeFile(paths.command, commandText);
    result.changed.push(paths.command);
  }

  recordInstall(
    {
      kind: 'claude',
      scope,
      settings: paths.settings,
      command: paths.command,
      backups: result.backups,
      installedAt: new Date(now).toISOString(),
    },
    env,
  );

  if (global) {
    result.notes.push('user scope applies to every Claude Code project on this machine');
  }
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
        const kept = list.filter((entry) => !isBuffyHook(entry));
        result.removedHooks += list.length - kept.length;
        if (kept.length) hooks[event] = kept;
        else delete hooks[event];
      }
      data.hooks = hooks;
      if (!Object.keys(hooks).length) delete data.hooks;

      const nextSettings = `${JSON.stringify(data, null, 2)}\n`;
      if (nextSettings !== text) {
        fs.writeFileSync(paths.settings, nextSettings);
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

  fs.writeFileSync(file, `${next}\n`);
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
