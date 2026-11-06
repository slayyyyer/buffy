'use strict';

const SLOTS = [
  {
    id: 'outfit',
    label: 'Outfit',
    items: [
      { id: 'princess', label: 'Princess', hint: 'The classic blue gown.', swatch: ['#82cdf2', '#f47fbd'] },
      { id: 'cozy', label: 'Cozy', hint: 'A soft sweater and warm slippers.', swatch: ['#fff4e0', '#e8b98d'] },
      { id: 'sleepover', label: 'Sleepover', hint: 'Pajamas and a starry top.', swatch: ['#e3d5ff', '#a98bd9'] },
      { id: 'rainy', label: 'Rainy day', hint: 'A yellow raincoat and boots.', swatch: ['#ffe08a', '#e0a92e'] },
      { id: 'starlight', label: 'Starlight', hint: 'A dark dress with gold stars.', swatch: ['#4a3d86', '#ffd36a'] },
    ],
  },
  {
    id: 'bow',
    label: 'Bow',
    items: [
      { id: 'none', label: 'No bow', swatch: 'transparent' },
      { id: 'pink', label: 'Pink', swatch: '#ff76b9' },
      { id: 'lavender', label: 'Lavender', swatch: '#b488ee' },
      { id: 'mint', label: 'Mint', swatch: '#66d2a8' },
      { id: 'gold', label: 'Gold', swatch: '#ffd36a' },
    ],
  },
  {
    id: 'hat',
    label: 'Hat',
    items: [
      { id: 'none', label: 'No hat', swatch: 'transparent' },
      { id: 'beret', label: 'Beret', swatch: '#dd4f9d' },
      { id: 'party', label: 'Party hat', swatch: '#ffd36a' },
      { id: 'sunhat', label: 'Sun hat', swatch: ['#f6dfae', '#d9b775'] },
    ],
  },
  {
    id: 'glasses',
    label: 'Glasses',
    items: [
      { id: 'none', label: 'No glasses', swatch: 'transparent' },
      { id: 'round', label: 'Round', swatch: '#8e9fe6' },
      { id: 'heart', label: 'Heart', swatch: '#e88fa9' },
      { id: 'star', label: 'Star', swatch: '#ffd36a' },
    ],
  },
  {
    id: 'wand',
    label: 'Wand',
    items: [
      { id: 'none', label: 'No wand', swatch: 'transparent' },
      { id: 'star', label: 'Star wand', swatch: '#ffd36a' },
      { id: 'heart', label: 'Heart wand', swatch: '#e88fa9' },
    ],
  },
  {
    id: 'theme',
    label: 'Theme',
    items: [
      { id: 'rose', label: 'Rose', swatch: ['#ffd3eb', '#f47fbd'] },
      { id: 'lavender', label: 'Lavender', swatch: ['#eadcff', '#a77ae0'] },
      { id: 'mint', label: 'Mint', swatch: ['#d9fff1', '#66bfa0'] },
      { id: 'sky', label: 'Sky', swatch: ['#dff2ff', '#74b6e6'] },
      { id: 'butter', label: 'Butter', swatch: ['#fff7d9', '#f5c96b'] },
      { id: 'midnight', label: 'Midnight', swatch: ['#3b3566', '#b9a6ff'] },
    ],
  },
];

const DEFAULTS = {
  outfit: 'princess',
  bow: 'none',
  hat: 'none',
  glasses: 'none',
  wand: 'none',
  theme: 'rose',
};

const BUILTIN_PRESETS = [
  {
    id: 'builtin-royal',
    name: 'Royal',
    builtin: true,
    look: { outfit: 'princess', bow: 'pink', hat: 'none', glasses: 'none', wand: 'star', theme: 'rose' },
  },
  {
    id: 'builtin-cozy',
    name: 'Cozy',
    builtin: true,
    look: { outfit: 'cozy', bow: 'mint', hat: 'none', glasses: 'round', wand: 'none', theme: 'butter' },
  },
  {
    id: 'builtin-starlight',
    name: 'Starlight',
    builtin: true,
    look: { outfit: 'starlight', bow: 'lavender', hat: 'none', glasses: 'star', wand: 'heart', theme: 'midnight' },
  },
];

const CATALOG = { version: 2, slots: SLOTS, builtinPresets: BUILTIN_PRESETS };
const MAX_PRESETS = 12;

function catalogItems(slotId) {
  const slot = SLOTS.find((entry) => entry.id === slotId);
  return slot ? slot.items.map((item) => item.id) : [];
}

function normalizeWand(value) {
  if (value === true) return 'star';
  if (value === false || value == null) return 'none';
  return catalogItems('wand').includes(value) ? value : DEFAULTS.wand;
}

function normalizeLook(raw) {
  const next = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const look = {};
  for (const slot of SLOTS) {
    const items = slot.items.map((item) => item.id);
    if (slot.id === 'wand') {
      look.wand = normalizeWand(next.wand);
    } else {
      look[slot.id] = items.includes(next[slot.id]) ? next[slot.id] : DEFAULTS[slot.id];
    }
  }
  return look;
}

function normalizePresets(raw) {
  if (!Array.isArray(raw)) return [];
  const presets = [];
  const ids = new Set();
  const names = new Set();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if (typeof entry.id !== 'string' || !entry.id.trim()) continue;
    const name = String(entry.name || '').trim().slice(0, 24);
    if (!name) continue;
    const id = entry.id.trim();
    const lower = name.toLowerCase();
    if (ids.has(id) || names.has(lower)) continue;
    ids.add(id);
    names.add(lower);
    presets.push({
      id,
      name,
      look: normalizeLook(entry.look),
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
    });
    if (presets.length >= MAX_PRESETS) break;
  }
  return presets;
}

function normalizeWardrobe(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const look = normalizeLook(raw);
  return { version: 2, ...look, presets: normalizePresets(raw.presets) };
}

function lookOf(wardrobe) {
  const normalized = normalizeWardrobe(wardrobe);
  return {
    outfit: normalized.outfit,
    bow: normalized.bow,
    hat: normalized.hat,
    glasses: normalized.glasses,
    wand: normalized.wand,
    theme: normalized.theme,
  };
}

function applyLook(wardrobe, look) {
  const base = normalizeWardrobe(wardrobe);
  const next = normalizeLook({ ...lookOf(base), ...(look && typeof look === 'object' ? look : {}) });
  return { ...base, ...next, presets: base.presets };
}

function sameLook(a, b) {
  const left = lookOf(a);
  const right = lookOf(b);
  return Object.keys(DEFAULTS).every((key) => left[key] === right[key]);
}

function addPreset(wardrobe, name, { id, now } = {}) {
  const base = normalizeWardrobe(wardrobe);
  const cleaned = String(name || '').trim();
  if (!cleaned) return { wardrobe: base, preset: null, error: 'Give this look a name.' };
  if (cleaned.length > 24) return { wardrobe: base, preset: null, error: 'Look names can be at most 24 characters.' };
  if (!id || typeof id !== 'string') return { wardrobe: base, preset: null, error: 'Could not save this look.' };
  if (base.presets.some((preset) => preset.name.toLowerCase() === cleaned.toLowerCase())) {
    return { wardrobe: base, preset: null, error: 'You already saved a look with that name.' };
  }
  if (base.presets.length >= MAX_PRESETS) {
    return { wardrobe: base, preset: null, error: `You can save up to ${MAX_PRESETS} looks.` };
  }
  const preset = {
    id,
    name: cleaned,
    look: lookOf(base),
    createdAt: now || new Date().toISOString(),
  };
  return { wardrobe: { ...base, presets: [...base.presets, preset] }, preset, error: null };
}

function removePreset(wardrobe, id) {
  const base = normalizeWardrobe(wardrobe);
  if (BUILTIN_PRESETS.some((preset) => preset.id === id)) {
    return { wardrobe: base, error: 'Built-in looks cannot be deleted.' };
  }
  if (!base.presets.some((preset) => preset.id === id)) {
    return { wardrobe: base, error: 'That look no longer exists.' };
  }
  return { wardrobe: { ...base, presets: base.presets.filter((preset) => preset.id !== id) }, error: null };
}

function findPreset(wardrobe, id) {
  const builtin = BUILTIN_PRESETS.find((preset) => preset.id === id);
  if (builtin) return { ...builtin, look: { ...builtin.look } };
  const preset = normalizeWardrobe(wardrobe).presets.find((entry) => entry.id === id);
  return preset ? { ...preset, look: { ...preset.look } } : null;
}

function randomLook(random = Math.random) {
  const look = {};
  for (const slot of SLOTS) {
    const items = slot.items;
    const index = Math.min(items.length - 1, Math.floor(random() * items.length));
    look[slot.id] = items[index].id;
  }
  return look;
}

module.exports = {
  CATALOG,
  SLOTS,
  DEFAULTS,
  MAX_PRESETS,
  normalizeWardrobe,
  normalizeLook,
  lookOf,
  applyLook,
  sameLook,
  addPreset,
  removePreset,
  findPreset,
  randomLook,
};
