'use strict';

const SIZES = {
  full: { width: 380, height: 650 },
  compose: { width: 420, height: 780 },
  cards: { width: 420, height: 760 },
  compact: { width: 234, height: 300 },
};

const SCALES = [0.8, 1, 1.25, 1.5, 1.75];
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function normalizeCorners(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const corners = {};
  for (const [key, value] of Object.entries(source)) {
    if (!/^[\w.-]{1,64}$/.test(key)) continue;
    if (CORNERS.includes(value)) corners[key] = value;
  }
  return corners;
}

function normalizeWindowState(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const legacy = Number.isFinite(source.x) && Number.isFinite(source.y) ? { x: source.x, y: source.y } : null;
  const full = source.full && Number.isFinite(source.full.x) && Number.isFinite(source.full.y)
    ? { x: source.full.x, y: source.full.y }
    : legacy;
  const compact = source.compact && Number.isFinite(source.compact.x) && Number.isFinite(source.compact.y)
    ? { x: source.compact.x, y: source.compact.y }
    : null;
  const scale = SCALES.includes(Number(source.scale)) ? Number(source.scale) : 1;
  return {
    full,
    compact,
    scale,
    corners: normalizeCorners(source.corners),
    migrated: Boolean(legacy && !source.full),
  };
}

function sizeFor(mode, scale = 1) {
  const base = SIZES[mode] || SIZES.full;
  const factor = SCALES.includes(Number(scale)) ? Number(scale) : 1;
  return {
    width: Math.round(base.width * factor),
    height: Math.round(base.height * factor),
  };
}

function visibleOn(bounds, displays, minVisible = 48) {
  return displays.some((display) => {
    const area = display.workArea || display.bounds;
    return (
      bounds.x + bounds.width - minVisible > area.x &&
      bounds.x + minVisible < area.x + area.width &&
      bounds.y + bounds.height - minVisible > area.y &&
      bounds.y + minVisible < area.y + area.height
    );
  });
}

function clampToDisplay(bounds, area) {
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width);
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height);
  return { ...bounds, x: Math.round(x), y: Math.round(y) };
}

function defaultPosition(area, size, gap = 24) {
  return {
    x: Math.round(area.x + area.width - size.width - gap),
    y: Math.round(area.y + area.height - size.height - gap),
  };
}

function cornerPosition(area, size, corner, gap = 24) {
  if (!CORNERS.includes(corner)) return defaultPosition(area, size, gap);
  return {
    x: Math.round(corner.endsWith('left') ? area.x + gap : area.x + area.width - size.width - gap),
    y: Math.round(corner.startsWith('top') ? area.y + gap : area.y + area.height - size.height - gap),
  };
}

/** Which corner is the window resting in, if any. Used for menu checkmarks. */
function cornerOf(bounds, area, gap = 24, tolerance = 4) {
  const near = (value, target) => Math.abs(value - target) <= tolerance;
  const column = near(bounds.x - area.x, gap)
    ? 'left'
    : near(area.x + area.width - (bounds.x + bounds.width), gap)
      ? 'right'
      : null;
  const row = near(bounds.y - area.y, gap)
    ? 'top'
    : near(area.y + area.height - (bounds.y + bounds.height), gap)
      ? 'bottom'
      : null;
  return column && row ? `${row}-${column}` : null;
}

function placeNearCursor(cursor, size, displays, gap = 18) {
  const display =
    displays.find((entry) => {
      const area = entry.workArea || entry.bounds;
      return cursor.x >= area.x && cursor.x < area.x + area.width && cursor.y >= area.y && cursor.y < area.y + area.height;
    }) || displays[0];
  if (!display) return { x: 0, y: 0 };
  const area = display.workArea || display.bounds;
  const preferred = {
    x: cursor.x - Math.round(size.width * 0.72),
    y: cursor.y - Math.round(size.height * 0.3),
  };
  const fallback = {
    x: area.x + area.width - size.width - gap,
    y: area.y + area.height - size.height - gap,
  };
  const candidate = Number.isFinite(cursor.x) && Number.isFinite(cursor.y) ? preferred : fallback;
  return clampToDisplay({ ...candidate, width: size.width, height: size.height }, area);
}

module.exports = {
  SIZES,
  SCALES,
  CORNERS,
  normalizeWindowState,
  normalizeCorners,
  sizeFor,
  visibleOn,
  clampToDisplay,
  defaultPosition,
  cornerPosition,
  cornerOf,
  placeNearCursor,
};
