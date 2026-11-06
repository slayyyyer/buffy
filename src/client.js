import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DAEMON_SCRIPT = path.resolve(HERE, 'daemon.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tiny JSON-over-HTTP helper for the loopback daemon. */
export function httpJson({ port, method = 'GET', path: pathname = '/', body, timeout = 1200, source } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = { accept: 'application/json' };
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = payload.length;
    }
    if (source) headers['x-buffy-source'] = source;

    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers, timeout }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = { raw: text };
        }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error(`daemon did not answer within ${timeout}ms`), { code: 'ETIMEDOUT' }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function health(port, timeout = 400) {
  try {
    const { status, data } = await httpJson({ port, path: '/health', timeout });
    if (status === 200 && data?.ok) return data;
  } catch {
    /* not running */
  }
  return null;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(300, () => finish(false));
  });
}

/** Start the daemon on demand so `buffy event` always works from a bare repo. */
export async function ensureDaemon({ port, env = process.env, waitMs = 6000 } = {}) {
  const existing = await health(port);
  if (existing) return existing;

  const child = spawn(process.execPath, [DAEMON_SCRIPT], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...env, BUFFY_PORT: String(port) },
  });
  child.on('error', () => {});
  child.unref();

  const deadline = Date.now() + waitMs;
  const checkedAt = Date.now() + 1200;
  while (Date.now() < deadline) {
    await sleep(120);
    const info = await health(port);
    if (info) return info;
    if (Date.now() > checkedAt && (await portOpen(port))) {
      throw new Error(`port ${port} is already in use by something that is not a buffy daemon`);
    }
  }
  throw new Error(`daemon did not start on port ${port}. Try \`buffy daemon\` to see why.`);
}

export async function postEvent(port, event) {
  const { status, data } = await httpJson({ port, method: 'POST', path: '/event', body: event, timeout: 1500, source: event.source });
  if (status !== 200 || !data?.ok) throw new Error(data?.error || `daemon returned ${status}`);
  return data.state;
}

export async function getState(port, timeout = 900) {
  const { status, data } = await httpJson({ port, path: '/state', timeout });
  if (status !== 200) throw new Error(data?.error || `daemon returned ${status}`);
  return data;
}

export async function sendPet(port) {
  const { status, data } = await httpJson({ port, method: 'POST', path: '/pet', timeout: 1500 });
  if (status !== 200 || !data?.ok) throw new Error(data?.error || `daemon returned ${status}`);
  return data.state;
}

export async function sendSprite(port, sprite) {
  const { status, data } = await httpJson({ port, method: 'POST', path: '/sprite', body: { sprite }, timeout: 1500 });
  if (status !== 200 || !data?.ok) throw new Error(data?.error || `daemon returned ${status}`);
  return data.state;
}
