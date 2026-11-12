import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { readConfig } from '../src/config.js';
import { startDaemon } from '../src/daemon.js';
import { buildHatchPrompt, generateHatch } from '../src/hatch.js';
import { createState, loadState, saveState } from '../src/state.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'buffy.js');
const NOW = Date.UTC(2026, 0, 2, 3, 4, 5);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makePng(width = 8, height = 8) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = 90;
    pixels[i * 4 + 1] = 200;
    pixels[i * 4 + 2] = 160;
    pixels[i * 4 + 3] = 255;
  }
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG = makePng();

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buffy-hatch-'));
  const env = {
    ...process.env,
    BUFFY_HOME: home,
    BUFFY_FREEBUFF_HOME: `${home}/no-freebuff`,
    CLAUDE_CONFIG_DIR: `${home}/no-claude`,
  };
  delete env.BUFFY_PORT;
  delete env.OPENAI_API_KEY;
  return { home, env };
}

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: ROOT, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('hatch prompt adds sprite constraints', () => {
  const prompt = buildHatchPrompt('  a sleepy mint axolotl  ');
  assert.match(prompt, /a sleepy mint axolotl/);
  assert.match(prompt, /transparent background/i);
  assert.match(prompt, /one character only/i);
  assert.match(prompt, /100 pixels/i);
  assert.throws(() => buildHatchPrompt('   '), /needs a prompt/);
});

test('generateHatch posts the right request and stores the sprite', async () => {
  const { home, env } = tempHome();
  env.OPENAI_API_KEY = 'test-key';
  saveState(createState({ name: 'Pip', seed: 42, now: NOW }), env);
  const calls = [];

  try {
    const result = await generateHatch({
      prompt: 'a red fox',
      config: {
        hatch: {
          provider: 'openai',
          model: 'gpt-image-1',
          size: '1024x1024',
          quality: 'medium',
          baseUrl: 'https://images.example.test/v1/',
        },
      },
      env,
      now: NOW,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ b64_json: PNG.toString('base64') }] }),
        };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://images.example.test/v1/images/generations');
    assert.equal(calls[0].init.headers.authorization, 'Bearer test-key');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.model, 'gpt-image-1');
    assert.equal(body.n, 1);
    assert.equal(body.size, '1024x1024');
    assert.equal(body.quality, 'medium');
    assert.equal(body.background, 'transparent');
    assert.equal(body.output_format, 'png');
    assert.match(body.prompt, /a red fox/);

    assert.ok(fs.existsSync(result.file));
    assert.deepEqual(fs.readFileSync(result.file), PNG);
    assert.match(result.file, /[\\/]sprites[\\/]hatch-/);

    const state = loadState(env);
    assert.equal(state.companion.name, 'Pip');
    assert.equal(state.companion.seed, 42);
    assert.equal(state.companion.sprite.type, 'image');
    assert.equal(state.companion.sprite.file, result.file);
    assert.equal(state.companion.sprite.prompt, 'a red fox');
    assert.equal(state.companion.sprite.model, 'gpt-image-1');
    assert.ok(state.companion.sprite.palette);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('generateHatch fails cleanly without a key or on an API error', async () => {
  const missing = tempHome();
  const failed = tempHome();
  const env = { ...failed.env, OPENAI_API_KEY: 'test-key' };

  try {
    await assert.rejects(
      generateHatch({
        prompt: 'a red fox',
        config: { hatch: { provider: 'openai' } },
        env: missing.env,
        fetchImpl: async () => {
          throw new Error('must not be called');
        },
      }),
      (error) => error.code === 'MISSING_API_KEY' && /OPENAI_API_KEY/.test(error.message),
    );

    await assert.rejects(
      generateHatch({
        prompt: 'a red fox',
        config: { hatch: { provider: 'openai' } },
        env,
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          json: async () => ({ error: { message: 'bad key' } }),
        }),
      }),
      /401: bad key/,
    );
    assert.equal(fs.existsSync(path.join(failed.home, 'sprites')), false);
  } finally {
    fs.rmSync(missing.home, { recursive: true, force: true });
    fs.rmSync(failed.home, { recursive: true, force: true });
  }
});

test('CLI hatch generates, refreshes the daemon, and serves the PNG', async () => {
  const { home, env } = tempHome();
  const baseConfig = readConfig(env);
  const daemon = await startDaemon({
    config: { ...baseConfig, port: 0, watch: { ...baseConfig.watch, enabled: false } },
    env,
    quiet: true,
  });

  let received = null;
  const mock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }));
    });
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const mockPort = mock.address().port;

  try {
    fs.writeFileSync(
      path.join(home, 'config.json'),
      `${JSON.stringify(
        {
          port: daemon.port,
          watch: { enabled: false },
          hatch: {
            provider: 'openai',
            model: 'gpt-image-1',
            size: '1024x1024',
            quality: 'medium',
            baseUrl: `http://127.0.0.1:${mockPort}/v1/`,
          },
        },
        null,
        2,
      )}\n`,
    );

    const before = await fetch(`http://127.0.0.1:${daemon.port}/sprite`);
    assert.equal(before.status, 404);

    const invalid = await fetch(`http://127.0.0.1:${daemon.port}/sprite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sprite: { type: 'image', file: path.join(ROOT, 'package.json') } }),
    });
    assert.equal(invalid.status, 400);

    const result = await runCli(['hatch', 'a tiny moss dragon'], { ...env, OPENAI_API_KEY: 'test-key' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Hatched!/);
    assert.equal(result.stdout.includes('test-key'), false);

    assert.equal(received.url, '/v1/images/generations');
    assert.equal(received.auth, 'Bearer test-key');
    assert.equal(received.body.background, 'transparent');
    assert.equal(received.body.output_format, 'png');

    const state = await (await fetch(`http://127.0.0.1:${daemon.port}/state`)).json();
    assert.equal(state.companion.sprite.type, 'image');
    assert.equal(state.companion.sprite.prompt, 'a tiny moss dragon');

    const sprite = await fetch(`http://127.0.0.1:${daemon.port}/sprite`);
    assert.equal(sprite.status, 200);
    assert.match(sprite.headers.get('content-type'), /image\/png/);
    assert.deepEqual(Buffer.from(await sprite.arrayBuffer()), PNG);
  } finally {
    await daemon.close();
    await new Promise((resolve) => mock.close(resolve));
    fs.rmSync(home, { recursive: true, force: true });
  }
});
