#!/usr/bin/env node
/**
 * Watch the daemon's `/state` until a turn from the Freebuff database adapter
 * appears, then report it.
 *
 * `buffy status` gives a snapshot; this waits for the one transition that proves
 * the database path works on this machine: a session whose source is
 * `freebuff-db` entering an active state. Start a local turn in Freebuff
 * Desktop, run this, and it prints the session instead of requiring a poll.
 *
 *   node scripts/watch-freebuff-turn.js                  # daemon on the default port
 *   node scripts/watch-freebuff-turn.js --port 4749      # another instance
 *   node scripts/watch-freebuff-turn.js --timeout 900 --json
 *
 * Exits 0 on the first database turn, 2 if the timeout passes without one, and
 * 1 on bad usage. No dependencies: Node's own fetch and timers.
 */

const SOURCE = 'freebuff-db';
const ACTIVE = new Set(['thinking', 'working']);
const DEFAULT_PORT = 4517;

function parseArgs(argv) {
  const options = {
    port: process.env.BUFFY_PORT || String(DEFAULT_PORT),
    url: null,
    timeout: 300,
    interval: 1000,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === '--port') options.port = value();
    else if (arg === '--url') options.url = value();
    else if (arg === '--timeout') options.timeout = Number(value());
    else if (arg === '--interval') options.interval = Number(value());
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown option ${arg}`);
  }
  if (options.help) return options;
  if (!options.url && !/^\d+$/.test(options.port)) throw new Error(`--port must be a number, got ${options.port}`);
  if (!Number.isFinite(options.timeout) || options.timeout <= 0) throw new Error('--timeout must be a positive number of seconds');
  if (!Number.isFinite(options.interval) || options.interval < 100) throw new Error('--interval must be at least 100ms');
  return options;
}

function usage() {
  return [
    'usage: node scripts/watch-freebuff-turn.js [--port 4517] [--url http://127.0.0.1:4517/state]',
    '                                            [--timeout 300] [--interval 1000] [--json]',
    '',
    'Watches /state and reports the first session from the Freebuff database',
    'adapter (source "freebuff-db") that enters thinking or working.',
  ].join('\n');
}

function clock(at = new Date()) {
  return at.toISOString().slice(11, 19);
}

function say(options, line) {
  if (!options.json) console.log(line);
}

function describe(session) {
  const bits = [session.state, `${session.category || 'session'}`];
  if (session.message) bits.push(JSON.stringify(session.message));
  if (session.quiet) bits.push(`quiet ${Math.round((session.quietForMs || 0) / 1000)}s`);
  return bits.join('  ');
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

function healthUrlFor(stateUrl) {
  return /\/state(\?|#|$)/.test(stateUrl) ? stateUrl.replace(/\/state(\?|#|$)/, '/health$1') : null;
}

function adapterLine(health) {
  const adapter = health?.adapters?.freebuff;
  if (!adapter) return 'the daemon reports no Freebuff adapter (an older build?)';
  const scope = adapter.available ? `${adapter.projects ?? 0} project databases under ${adapter.root}` : adapter.reason || 'unavailable';
  return `freebuff adapter ${adapter.enabled ? 'enabled' : 'disabled'}, ${scope}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const stateUrl = options.url || `http://127.0.0.1:${options.port}/state`;
  const healthUrl = healthUrlFor(stateUrl);
  const startedAt = Date.now();
  const deadline = startedAt + options.timeout * 1000;

  say(options, `watching ${stateUrl} for a ${SOURCE} turn (timeout ${options.timeout}s)`);

  let health = null;
  if (healthUrl) {
    try {
      health = await getJson(healthUrl);
      say(options, adapterLine(health));
    } catch {
      /* the daemon may still be starting; the loop below keeps trying */
    }
  }

  const seen = new Map();
  let lastState = null;
  let failures = 0;
  let reachable = false;

  while (Date.now() < deadline) {
    let snapshot = null;
    try {
      snapshot = await getJson(stateUrl);
      failures = 0;
      reachable = true;
    } catch (error) {
      failures += 1;
      if (failures === 1) say(options, `${clock()}  waiting for the daemon: ${error.message}`);
    }

    if (snapshot) {
      const current = snapshot.current || {};
      lastState = `${current.state ?? 'unknown'} (source ${current.source ?? 'none'})`;
      const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];

      for (const session of sessions) {
        if (session.source !== SOURCE) continue;
        const previous = seen.get(session.id);
        if (previous !== session.state) {
          seen.set(session.id, session.state);
          say(options, `${clock()}  ${SOURCE} ${describe(session)}`);
        }
      }

      const hit = sessions.find((session) => session.source === SOURCE && ACTIVE.has(session.state));
      // The active source is normally listed in `sessions`; fall back to the
      // top-level state for a daemon that trims the list.
      const top =
        !hit && current.source === SOURCE && ACTIVE.has(current.state)
          ? { ...current, id: current.sessionId ?? 'freebuff' }
          : null;
      const found = hit || top;

      if (found) {
        if (!health && healthUrl) {
          try {
            health = await getJson(healthUrl);
          } catch {
            /* health is context, not proof */
          }
        }
        if (options.json) {
          console.log(JSON.stringify({
            found: true,
            elapsedMs: Date.now() - startedAt,
            session: found,
            adapter: health?.adapters?.freebuff ?? null,
            version: health?.version ?? null,
          }));
        } else {
          console.log('');
          console.log(`first Freebuff database turn: ${found.state}`);
          console.log(`  at        ${new Date().toISOString()}`);
          console.log(`  session   ${found.id} (source ${found.source}, observed ${found.observed ?? 'unknown'})`);
          console.log(`  activity  ${found.category ?? 'session'}${found.message ? ` — ${found.message}` : ''}`);
          console.log(`  quiet     ${found.quiet ? `yes, ${Math.round((found.quietForMs || 0) / 1000)}s without a new event` : 'no'}`);
          if (healthUrl) console.log(`  daemon    ${health ? adapterLine(health) : 'health unavailable'}`);
          console.log('');
          console.log('The database path is live on this machine.');
        }
        return 0;
      }
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(options.interval, remaining)));
  }

  const summary = {
    found: false,
    waitedMs: Date.now() - startedAt,
    reachable,
    lastState,
    adapter: health?.adapters?.freebuff ?? null,
  };

  if (options.json) {
    console.log(JSON.stringify(summary));
  } else {
    if (!reachable) {
      console.log('');
      console.log(`nothing answered at ${stateUrl} for ${options.timeout}s.`);
      console.log('  start the app, or pass --port for the instance you are running.');
    } else {
      console.log('');
      console.log(`no ${SOURCE} turn within ${options.timeout}s.`);
      console.log(`  last state  ${lastState}`);
      if (health) {
        console.log(`  adapter     ${adapterLine(health)}`);
        const adapter = health.adapters?.freebuff;
        if (adapter?.enabled && adapter?.available) {
          console.log('  note        the adapter is reading real projects, so no local turn reached desktop-v2.db yet.');
        } else if (adapter && !adapter.enabled) {
          console.log('  note        the Freebuff database source is switched off in Settings or config.json.');
        }
      }
    }
  }
  return 2;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`watch-freebuff-turn: ${error.message}`);
    console.error('');
    console.error(usage());
    process.exitCode = 1;
  });
