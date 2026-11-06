import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { STATES, VERSION, buffyDir, readConfig } from './config.js';
import { startDaemon } from './daemon.js';
import { normalizeState } from './machine.js';
import { applyIdleDecay, levelFromXp, loadState } from './state.js';
import * as client from './client.js';
import { generateHatch } from './hatch.js';
import { runClaudeHook } from './hook.js';
import { CLAUDE_HOOKS, installClaude, installFreebuff, uninstallClaude, uninstallFreebuff } from './install.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const HELP = `buffy ${VERSION} — a small companion for your coding agents

Usage:
  buffy daemon                     run the daemon in the foreground
  buffy event <state> [options]    send a state change
      --msg "text"                 speech bubble text
      --source claude|freebuff|…   who sent it (shown in the bubble)
  buffy pet                        scratch behind the ears
  buffy status [--json]            state, mood, XP, daemon health
  buffy overlay [--dev]            show the always-on-top pet window
  buffy hatch "<prompt>"           generate a custom sprite with OpenAI Images
  buffy install claude [--global]  wire Claude Code hooks + /buffy command
  buffy install freebuff           add best-effort event instructions to AGENTS.md
  buffy uninstall claude [--global] remove them again
  buffy uninstall freebuff         remove them from AGENTS.md
  buffy help | buffy version

States: ${STATES.join(', ')}
Overlay: drag to move, click to pet, right-click for the menu.
Docs: README.md
`;

function print(text = '') {
  process.stdout.write(`${text}\n`);
}

function fail(text) {
  process.stderr.write(`${text}\n`);
}

function parseArgs(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--') {
      args.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq > -1) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[token.slice(2)] = argv[i + 1];
        i += 1;
      } else {
        flags[token.slice(2)] = true;
      }
    } else {
      args.push(token);
    }
  }
  return { args, flags };
}

function ago(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function offlineSnapshot() {
  const stored = loadState();
  if (stored) applyIdleDecay(stored, Date.now());
  return {
    online: false,
    version: VERSION,
    pet: stored?.pet ?? null,
    xp: stored?.xp ?? 0,
    level: levelFromXp(stored?.xp ?? 0),
    mood: Math.round(stored?.mood ?? 70),
    current: { state: 'idle', message: null, source: null, since: null, seq: 0 },
    reaction: null,
  };
}

function printStatus(snapshot, config) {
  const pet = snapshot.pet;
  const sprite = pet?.sprite;
  const custom = sprite?.type === 'image' || sprite?.type === 'sheet';
  print(`${pet?.name ?? 'buffy'} · ${custom ? 'custom sprite' : 'placeholder blob'} · Lv ${snapshot.level} · ${snapshot.xp} xp`);
  const source = snapshot.current?.source;
  const since = snapshot.current?.since ? `, ${ago(Date.now() - snapshot.current.since)} ago` : '';
  print(`state   ${snapshot.current?.state ?? 'idle'}${source ? ` (${source}${since})` : ''}`);
  print(`mood    ${snapshot.mood}/100`);
  if (snapshot.current?.message) print(`message ${snapshot.current.message}`);
  print(
    snapshot.online
      ? `daemon  online at 127.0.0.1:${config.port}${snapshot.pid ? ` (pid ${snapshot.pid})` : ''}`
      : `daemon  offline — run \`buffy overlay\` or \`buffy daemon\``,
  );
  if (snapshot.watch?.enabled) {
    print(`watch   ${snapshot.watch.directory} (quiet ${snapshot.watch.quietMs}ms, git ${snapshot.watch.git ? 'on' : 'off'})`);
  } else if (snapshot.watch?.reason) {
    print(`watch   off (${snapshot.watch.reason})`);
  }
}

async function statusCommand(flags, config) {
  let snapshot = null;
  try {
    snapshot = await client.getState(config.port);
  } catch {
    /* genuinely offline; fall back to the persisted pet */
  }
  if (!snapshot) snapshot = offlineSnapshot();
  const payload = { ...snapshot, daemonPort: config.port };
  if (flags.json) {
    print(JSON.stringify(payload, null, 2));
    return 0;
  }
  printStatus(payload, config);
  return 0;
}

async function eventCommand(rest, flags, config) {
  const raw = rest.join(' ').trim();
  if (!raw) {
    fail(`buffy: event needs a state. States: ${STATES.join(', ')}`);
    return 2;
  }
  let state;
  try {
    state = normalizeState(raw);
  } catch (error) {
    fail(`buffy: ${error.message}`);
    return 2;
  }
  const message = typeof flags.msg === 'string' ? flags.msg : null;
  const source = (typeof flags.source === 'string' ? flags.source : process.env.BUFFY_SOURCE || 'cli').slice(0, 40);
  try {
    await client.ensureDaemon({ port: config.port });
    await client.postEvent(config.port, { state, message, source });
  } catch (error) {
    fail(`buffy: ${error.message}`);
    return 1;
  }
  return 0;
}

async function petCommand(config) {
  try {
    await client.ensureDaemon({ port: config.port });
    const snapshot = await client.sendPet(config.port);
    print(`${snapshot.pet.name} seems pleased. (mood ${snapshot.mood}/100 · ${snapshot.xp} xp)`);
    return 0;
  } catch (error) {
    fail(`buffy: ${error.message}`);
    return 1;
  }
}

async function overlayCommand(flags, config) {
  try {
    await client.ensureDaemon({ port: config.port });
  } catch (error) {
    fail(`buffy: ${error.message}`);
    return 1;
  }

  let electronPath;
  try {
    ({ default: electronPath } = await import('electron'));
  } catch {
    fail('buffy: Electron is not installed. Run `npm install` in this project first.');
    return 1;
  }

  const args = [ROOT];
  if (flags.dev) args.push('--dev');
  if (typeof flags.shot === 'string') args.push('--shot', path.resolve(flags.shot));
  if (flags['shot-exit']) args.push('--shot-exit');

  const child = spawn(electronPath, args, {
    detached: true,
    stdio: 'ignore',
    cwd: ROOT,
    env: { ...process.env, BUFFY_PORT: String(config.port) },
  });
  child.unref();
  print('buffy overlay starting… (drag to move, click to pet, right-click for menu)');
  return 0;
}

async function daemonCommand(config) {
  const daemon = await startDaemon({ config });
  print(`buffy daemon listening on http://127.0.0.1:${daemon.port}`);
  print(`state: ${path.join(buffyDir(), 'state.json')}`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      daemon.close().finally(() => process.exit(0));
    });
  }
  await new Promise(() => {});
  return 0;
}

async function hatchCommand(prompt, config) {
  if (!prompt) {
    fail('buffy: hatch needs a prompt. Try: buffy hatch "a tiny green dragon"');
    return 2;
  }

  const model = config.hatch?.model || 'gpt-image-1';
  print(`Hatching "${prompt}" with ${model}… (this can take up to a minute)`);
  try {
    const { sprite, file } = await generateHatch({ prompt, config });
    const online = await client.health(config.port);
    if (online) {
      try {
        await client.sendSprite(config.port, sprite);
      } catch {
        /* the next overlay launch will read the saved state instead */
      }
    }
    print(`Hatched! ${file}`);
    print(online ? 'The overlay has the new sprite.' : 'Run `buffy overlay` to meet the new sprite.');
    return 0;
  } catch (error) {
    if (error.code === 'MISSING_API_KEY') {
      fail('buffy: hatch needs OPENAI_API_KEY.');
      fail('  PowerShell:  $env:OPENAI_API_KEY = "sk-..."');
      fail('  bash:        export OPENAI_API_KEY="sk-..."');
      fail('Then run the same hatch command again.');
      return 2;
    }
    fail(`buffy: ${error.message}`);
    return 1;
  }
}

function installCommand(agent, flags) {
  if (agent === 'freebuff') {
    if (flags.global) {
      fail('buffy: Freebuff reads AGENTS.md from the project root; --global is not supported.');
      return 2;
    }
    try {
      const result = installFreebuff();
      print('buffy installed for Freebuff (project scope)');
      print(`  instructions ${result.agentsPath}`);
      if (result.backups.length) print(`  backups      ${result.backups.join(', ')}`);
      print('The watcher is the dependable signal; AGENTS.md events are best-effort.');
      return 0;
    } catch (error) {
      fail(`buffy: ${error.message}`);
      return 1;
    }
  }
  if (agent !== 'claude') {
    fail('buffy: install supports "claude" or "freebuff".');
    return 2;
  }
  try {
    const result = installClaude({ global: Boolean(flags.global) });
    print(`buffy installed for Claude Code (${result.scope} scope)`);
    print(`  hooks    ${CLAUDE_HOOKS.map((hook) => hook.event).join(', ')}`);
    print(`  settings ${result.settingsPath}`);
    print(`  command  ${result.commandPath}`);
    if (result.backups.length) print(`  backups  ${result.backups.join(', ')}`);
    print('Start the overlay with `buffy overlay`, then use /buffy in Claude Code.');
    return 0;
  } catch (error) {
    fail(`buffy: ${error.message}`);
    return 1;
  }
}

function uninstallCommand(agent, flags) {
  if (agent === 'freebuff') {
    if (flags.global) {
      fail('buffy: Freebuff reads AGENTS.md from the project root; --global is not supported.');
      return 2;
    }
    try {
      const result = uninstallFreebuff();
      if (!result.removed) {
        print('AGENTS.md has no buffy block.');
      } else {
        print('buffy removed from Freebuff (project scope)');
        print(`  instructions ${result.removedFile ? 'file removed' : 'block removed'}`);
      }
      for (const note of result.notes) print(`  note  ${note}`);
      return 0;
    } catch (error) {
      fail(`buffy: ${error.message}`);
      return 1;
    }
  }
  if (agent !== 'claude') {
    fail('buffy: uninstall supports "claude" or "freebuff".');
    return 2;
  }
  try {
    const result = uninstallClaude({ global: Boolean(flags.global) });
    if (!result.removedHooks && !result.removedCommand) {
      print(`Nothing to remove for Claude Code (${result.scope} scope).`);
    } else {
      print(`buffy removed from Claude Code (${result.scope} scope)`);
      print(`  hooks removed  ${result.removedHooks}`);
      print(`  command        ${result.removedCommand ? 'removed' : 'left in place'}`);
    }
    for (const note of result.notes) print(`  note  ${note}`);
    return 0;
  } catch (error) {
    fail(`buffy: ${error.message}`);
    return 1;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { args, flags } = parseArgs(argv);
  const config = readConfig();
  const command = args[0] || 'help';

  if (flags.version) {
    print(VERSION);
    return 0;
  }

  if (flags.help || command === 'help' || command === '-h') {
    print(HELP);
    return 0;
  }

  switch (command) {
    case 'daemon':
      return daemonCommand(config);
    case 'event':
      return eventCommand(args.slice(1), flags, config);
    case 'pet':
      return petCommand(config);
    case 'status':
      return statusCommand(flags, config);
    case 'overlay':
      return overlayCommand(flags, config);
    case 'hatch':
      return hatchCommand(args.slice(1).join(' ').trim(), config);
    case 'hook': {
      const rest = args.slice(1);
      return runClaudeHook(rest[0] === 'claude' ? rest[1] : rest[0]);
    }
    case 'install':
      return installCommand(args[1], flags);
    case 'uninstall':
      return uninstallCommand(args[1], flags);
    case 'version':
    case '--version':
    case '-v':
      print(VERSION);
      return 0;
    default:
      fail(`buffy: unknown command "${command}"`);
      print(HELP);
      return 2;
  }
}
