import fs from 'node:fs';
import path from 'node:path';

import { buffyDir, ensureBuffyDir } from './config.js';
import { createState, loadState, saveState } from './state.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HATCH_TIMEOUT_MS = 120_000;

/** Turn a short idea into a prompt that produces one usable pet sprite. */
export function buildHatchPrompt(prompt) {
  const clean = String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!clean) throw new Error('hatch needs a prompt');
  return [
    `Create a single cute desktop-pet character: ${clean}.`,
    'Full body, front-facing, centered, one character only.',
    'Clean 2D vector-like illustration with soft thick outlines and large expressive eyes.',
    'Transparent background; no scenery, text, border, shadow, watermark, or checkerboard.',
    'The character must stay readable when scaled to about 100 pixels tall.',
  ].join(' ');
}

function apiBase(config) {
  return String(config?.hatch?.baseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
}

function imageError(message, code = 'HATCH_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Generate one transparent PNG and persist it as the pet's sprite.
 * `fetchImpl` is injectable so tests never call a real provider.
 */
export async function generateHatch({
  prompt,
  config = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
} = {}) {
  const hatch = {
    provider: 'openai',
    model: 'gpt-image-1',
    size: '1024x1024',
    quality: 'medium',
    ...(config.hatch || {}),
  };

  if (hatch.provider !== 'openai') {
    throw imageError(`hatch provider "${hatch.provider}" is not supported; set hatch.provider to "openai"`, 'UNSUPPORTED_PROVIDER');
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw imageError('OPENAI_API_KEY is not set', 'MISSING_API_KEY');
  }

  const userPrompt = String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!userPrompt) throw imageError('hatch needs a prompt', 'MISSING_PROMPT');

  let response;
  try {
    response = await fetchImpl(`${apiBase(config)}/images/generations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: hatch.model,
        prompt: buildHatchPrompt(userPrompt),
        n: 1,
        size: hatch.size,
        quality: hatch.quality,
        background: 'transparent',
        output_format: 'png',
      }),
      signal: AbortSignal.timeout(HATCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw imageError(`image generation timed out after ${HATCH_TIMEOUT_MS / 1000}s`);
    }
    throw imageError(`could not reach the image provider: ${error.message}`);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const data = await response.json();
      detail = data?.error?.message || data?.message || '';
    } catch {
      /* the status is still useful */
    }
    throw imageError(`image provider returned ${response.status}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw imageError('image provider returned invalid JSON');
  }

  const item = Array.isArray(body?.data) ? body.data[0] : null;
  let bytes;
  if (typeof item?.b64_json === 'string' && item.b64_json) {
    bytes = Buffer.from(item.b64_json, 'base64');
  } else if (typeof item?.url === 'string' && item.url) {
    const imageResponse = await fetchImpl(item.url, { signal: AbortSignal.timeout(HATCH_TIMEOUT_MS) });
    if (!imageResponse.ok) throw imageError(`could not download the generated image (${imageResponse.status})`);
    bytes = Buffer.from(await imageResponse.arrayBuffer());
  } else {
    throw imageError('image provider did not return an image');
  }

  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw imageError('image provider did not return a PNG; check the hatch model and baseUrl');
  }

  ensureBuffyDir(env);
  const spritesDir = path.join(buffyDir(env), 'sprites');
  fs.mkdirSync(spritesDir, { recursive: true });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  const id = `hatch-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  const file = path.join(spritesDir, `${id}.png`);
  fs.writeFileSync(file, bytes);

  const state = loadState(env) || createState({ now });
  const sprite = {
    type: 'image',
    id,
    file,
    prompt: userPrompt,
    model: String(hatch.model).slice(0, 80),
    createdAt: new Date(now).toISOString(),
  };
  state.pet.sprite = { ...state.pet.sprite, ...sprite };
  state.lastSeen = new Date(now).toISOString();
  saveState(state, env);

  return { sprite, file, state, finalPrompt: buildHatchPrompt(userPrompt) };
}
