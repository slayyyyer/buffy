'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// package.json marks .js as ESM, so the browser manifest cannot be require()d
// directly from this CommonJS module. Evaluate the trusted UMD file in a small
// sandbox instead; the browser still loads the exact same asset as a script.
function loadManifest() {
  const file = path.join(__dirname, 'characters', 'manifest.js');
  const sandbox = { module: { exports: {} }, exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  const manifest = sandbox.module.exports;
  if (!manifest || !Array.isArray(manifest.characters)) {
    throw new Error('character manifest could not be loaded');
  }
  return manifest;
}

const MANIFEST = loadManifest();

const SLOTS = [
  {
    id: 'outfit',
    label: 'Outfit',
    description: 'Clothes stay aligned across every supported pose.',
    items: [
      { id: 'none', label: 'No outfit', hint: 'Just the plush cloud.', swatch: 'transparent' },
      { id: 'dress', label: 'Cloud dress', hint: 'Cream pinafore with a plum sash.', swatch: ['#fff1dc', '#7b355f'] },
      { id: 'cozy', label: 'Cloud sweater', hint: 'A soft oatmeal knit and slippers.', swatch: ['#f4e4cd', '#c99d7a'] },
      { id: 'hoodie', label: 'Cloud hoodie', hint: 'An oversized lavender hoodie with a star patch.', swatch: ['#efe6fa', '#b9a0dd'] },
      { id: 'pinafore', label: 'Berry pinafore', hint: 'A strawberry pinafore over a cream blouse.', swatch: ['#e8a3b4', '#fff8ea'] },
      { id: 'pajamas', label: 'Pajamas', hint: 'A mint nightgown with tiny stars and cloud slippers.', swatch: ['#ddf3e7', '#fffaf2'] },
      { id: 'rainy', label: 'Raincoat', hint: 'A butter-yellow coat and boots.', swatch: ['#ffe09b', '#d8a53d'] },
      { id: 'starlight', label: 'Starlight', hint: 'Deep plum with tiny gold stars.', swatch: ['#3b2340', '#f6cf7d'] },
      { id: 'overalls', label: 'Garden overalls', hint: 'Dusty rose overalls with a leaf pocket.', swatch: ['#e7a7b8', '#7d9d72'] },
    ],
  },
  {
    id: 'bow',
    label: 'Bow',
    items: [
      { id: 'none', label: 'No bow', swatch: 'transparent' },
      { id: 'pink', label: 'Petal pink', swatch: '#e78bb0' },
      { id: 'lavender', label: 'Lavender', swatch: '#b79ad8' },
      { id: 'mint', label: 'Mint', swatch: '#9fd8c0' },
      { id: 'gold', label: 'Gold', swatch: '#e9c272' },
    ],
  },
  {
    id: 'hat',
    label: 'Hat',
    items: [
      { id: 'none', label: 'No hat', swatch: 'transparent' },
      { id: 'beret', label: 'Beret', swatch: '#a85f85' },
      { id: 'party', label: 'Party hat', swatch: ['#f6cf7d', '#e78bb0'] },
      { id: 'sunhat', label: 'Sun hat', swatch: ['#f3dfb6', '#c9a15f'] },
    ],
  },
  {
    id: 'glasses',
    label: 'Glasses',
    items: [
      { id: 'none', label: 'No glasses', swatch: 'transparent' },
      { id: 'round', label: 'Round', swatch: '#8f8ab8' },
      { id: 'heart', label: 'Heart', swatch: '#d4779d' },
      { id: 'star', label: 'Star', swatch: '#e9c272' },
    ],
  },
  {
    id: 'wand',
    label: 'Wand',
    items: [
      { id: 'none', label: 'No wand', swatch: 'transparent' },
      { id: 'star', label: 'Star wand', swatch: '#e9c272' },
      { id: 'heart', label: 'Heart wand', swatch: '#e78bb0' },
    ],
  },
  {
    id: 'theme',
    label: 'Theme',
    items: [
      { id: 'plum', label: 'Plum', swatch: ['#5c3150', '#f3b9cf'] },
      { id: 'rose', label: 'Rose', swatch: ['#f6c9dc', '#d978a4'] },
      { id: 'lavender', label: 'Lavender', swatch: ['#e4d6f7', '#a58cc9'] },
      { id: 'mint', label: 'Mint', swatch: ['#d6f2e4', '#7fbfa4'] },
      { id: 'sky', label: 'Sky', swatch: ['#d9ecfb', '#7fb3d9'] },
      { id: 'butter', label: 'Butter', swatch: ['#fbf0cf', '#d9b061'] },
      { id: 'midnight', label: 'Midnight', swatch: ['#2f2547', '#a99ad8'] },
    ],
  },
];

const SLOT_IDS = SLOTS.map((slot) => slot.id);
const SLOT_ITEMS = new Map(SLOTS.map((slot) => [slot.id, slot.items.map((item) => item.id)]));

const LEGACY_OUTFITS = new Map([
  ['princess', 'dress'],
  ['sleepover', 'overalls'],
]);

const BUILTIN_PRESETS = [
  {
    id: 'builtin-primrose',
    characterId: 'buffy',
    name: 'Primrose',
    description: 'The everyday look: cream dress, plum sash, one small bow.',
    look: { outfit: 'dress', bow: 'pink', hat: 'none', glasses: 'none', wand: 'none', theme: 'plum' },
  },
  {
    id: 'builtin-quiet-morning',
    characterId: 'buffy',
    name: 'Quiet morning',
    description: 'Sweater, round glasses, and a cup of tea.',
    look: { outfit: 'cozy', bow: 'none', hat: 'none', glasses: 'round', wand: 'none', theme: 'butter' },
  },
  {
    id: 'builtin-night-garden',
    characterId: 'buffy',
    name: 'Night garden',
    description: 'Starlight dress with gold stars and a heart wand.',
    look: { outfit: 'starlight', bow: 'lavender', hat: 'none', glasses: 'star', wand: 'heart', theme: 'midnight' },
  },
  {
    id: 'builtin-mochi',
    characterId: 'mochi',
    name: 'Mochi',
    description: 'The atlas bunny, exactly as drawn.',
    look: { outfit: 'none', bow: 'none', hat: 'none', glasses: 'none', wand: 'none', theme: 'rose' },
  },
];

const CHARACTERS = MANIFEST.characters.map((character) => ({
  ...character,
  defaultLook: { ...getCharacterLookDefaults(character) },
}));

function getCharacterLookDefaults(character) {
  return {
    outfit: character.outfits?.[0] || 'none',
    bow: character.accessories?.bow?.[0] || 'none',
    hat: character.accessories?.hat?.[0] || 'none',
    glasses: character.accessories?.glasses?.[0] || 'none',
    wand: character.accessories?.wand?.[0] || 'none',
    theme: character.themes?.[0] || 'plum',
  };
}

const CATALOG = {
  version: 3,
  slots: SLOTS,
  characters: CHARACTERS,
  builtinPresets: BUILTIN_PRESETS,
};

function getCharacter(id) {
  return CHARACTERS.find((character) => character.id === id) || CHARACTERS[0];
}

function allowedItems(character, slotId) {
  const all = SLOT_ITEMS.get(slotId) || [];
  if (slotId === 'outfit') return all.filter((id) => (character.outfits || ['none']).includes(id));
  if (slotId === 'theme') return all.filter((id) => (character.themes || ['plum']).includes(id));
  const list = character.accessories?.[slotId];
  return Array.isArray(list) ? all.filter((id) => list.includes(id)) : ['none'];
}

function defaultLook(characterId) {
  const character = getCharacter(characterId);
  return { ...character.defaultLook };
}

function normalizeLook(raw, characterId) {
  const character = getCharacter(characterId);
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const look = {};
  for (const slotId of SLOT_IDS) {
    let value = source[slotId];
    if (slotId === 'outfit' && LEGACY_OUTFITS.has(value)) value = LEGACY_OUTFITS.get(value);
    if (slotId === 'wand' && value === true) value = 'star';
    if (slotId === 'wand' && value === false) value = 'none';
    const allowed = allowedItems(character, slotId);
    look[slotId] = allowed.includes(value) ? value : character.defaultLook[slotId];
  }
  return look;
}

function lookWithClothing(look, clothing) {
  const next = { ...look };
  for (const key of ['outfit', 'bow', 'hat', 'glasses', 'wand']) {
    if (clothing && clothing[key] === false) next[key] = 'none';
  }
  return next;
}

function isLookAvailable(look, characterId, availableAssets) {
  const character = getCharacter(characterId);
  if (!look) return false;
  for (const slotId of SLOT_IDS) {
    const value = look[slotId];
    if (!allowedItems(character, slotId).includes(value)) return false;
    if (typeof availableAssets === 'function') {
      const asset = assetFor(character, slotId, value);
      if (asset && availableAssets(asset) === false) return false;
    }
  }
  return true;
}

function assetFor(character, slotId, value) {
  if (!value || value === 'none') return null;
  if (slotId === 'outfit') return character.outfitAssets?.[value] || null;
  if (slotId === 'theme') return null;
  return character.accessoryAssets?.[slotId]?.[value] || null;
}

function looksFor(characterId, characterPrefs) {
  const builtins = BUILTIN_PRESETS.filter((preset) => !preset.characterId || preset.characterId === characterId).map(
    (preset) => ({ ...preset, builtin: true, includeInRotation: true }),
  );
  const saved = Array.isArray(characterPrefs?.looks) ? characterPrefs.looks : [];
  return [...builtins, ...saved];
}

function findLook(characterId, characterPrefs, id) {
  return looksFor(characterId, characterPrefs).find((entry) => entry.id === id) || null;
}

function saveLook(characterPrefs, { id, name, now = Date.now() } = {}) {
  const cleaned = String(name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return { error: 'Give this look a name.', character: characterPrefs };
  if (cleaned.length > 40) return { error: 'Look names can be at most 40 characters.', character: characterPrefs };
  if (characterPrefs.looks.length >= 32) {
    return { error: 'You can save up to 32 looks for this character.', character: characterPrefs };
  }
  if (characterPrefs.looks.some((entry) => entry.name.toLowerCase() === cleaned.toLowerCase())) {
    return { error: 'You already have a look with that name.', character: characterPrefs };
  }
  const look = {
    id: id || `look-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleaned,
    look: { ...characterPrefs.look },
    createdAt: new Date(now).toISOString(),
    includeInRotation: true,
  };
  return {
    character: { ...characterPrefs, looks: [...characterPrefs.looks, look] },
    look,
  };
}

function renameLook(characterPrefs, id, name) {
  const cleaned = String(name || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return { error: 'Give this look a name.', character: characterPrefs };
  if (cleaned.length > 40) return { error: 'Look names can be at most 40 characters.', character: characterPrefs };
  if (characterPrefs.looks.some((entry) => entry.id !== id && entry.name.toLowerCase() === cleaned.toLowerCase())) {
    return { error: 'You already have a look with that name.', character: characterPrefs };
  }
  let found = false;
  const looks = characterPrefs.looks.map((entry) => {
    if (entry.id !== id) return entry;
    found = true;
    return { ...entry, name: cleaned };
  });
  return found ? { character: { ...characterPrefs, looks } } : { error: 'That look no longer exists.', character: characterPrefs };
}

function replaceLook(characterPrefs, id) {
  let found = false;
  const looks = characterPrefs.looks.map((entry) => {
    if (entry.id !== id) return entry;
    found = true;
    return { ...entry, look: { ...characterPrefs.look } };
  });
  return found ? { character: { ...characterPrefs, looks } } : { error: 'That look no longer exists.', character: characterPrefs };
}

function deleteLook(characterPrefs, id) {
  const builtin = BUILTIN_PRESETS.some((preset) => preset.id === id);
  if (builtin) return { error: 'Built-in looks cannot be deleted.', character: characterPrefs };
  const looks = characterPrefs.looks.filter((entry) => entry.id !== id);
  if (looks.length === characterPrefs.looks.length) {
    return { error: 'That look no longer exists.', character: characterPrefs };
  }
  return {
    character: {
      ...characterPrefs,
      looks,
      favorites: characterPrefs.favorites.filter((favorite) => favorite !== id),
    },
  };
}

function toggleRotationLook(characterPrefs, id, include) {
  let found = false;
  const looks = characterPrefs.looks.map((entry) => {
    if (entry.id !== id) return entry;
    found = true;
    return { ...entry, includeInRotation: include !== false };
  });
  if (!found) return { error: 'Only saved looks can be excluded from rotation.', character: characterPrefs };
  return { character: { ...characterPrefs, looks } };
}

function toggleFavorite(characterPrefs, id) {
  const favorites = new Set(characterPrefs.favorites || []);
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  return { ...characterPrefs, favorites: [...favorites] };
}

function randomLook(characterId, characterPrefs, random = Math.random) {
  const character = getCharacter(characterId);
  const favorites = new Set(characterPrefs?.favorites || []);
  const favoriteLooks = looksFor(characterId, characterPrefs).filter((entry) => favorites.has(entry.id));
  if (favoriteLooks.length && random() < 0.45) {
    const picked = favoriteLooks[Math.floor(random() * favoriteLooks.length)];
    return { ...picked.look };
  }
  const look = { ...character.defaultLook };
  for (const slotId of SLOT_IDS) {
    if (slotId === 'theme') continue;
    const allowed = allowedItems(character, slotId);
    if (!allowed.length) continue;
    look[slotId] = allowed[Math.floor(random() * allowed.length)];
  }
  const themes = allowedItems(character, 'theme');
  look.theme = themes[Math.floor(random() * themes.length)];
  return look;
}

module.exports = {
  CATALOG,
  CHARACTERS,
  SLOTS,
  SLOT_IDS,
  BUILTIN_PRESETS,
  getCharacter,
  allowedItems,
  defaultLook,
  normalizeLook,
  lookWithClothing,
  isLookAvailable,
  assetFor,
  looksFor,
  findLook,
  saveLook,
  renameLook,
  replaceLook,
  deleteLook,
  toggleRotationLook,
  toggleFavorite,
  randomLook,
};
