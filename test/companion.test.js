import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { createMachine } from '../src/machine.js';
import { mapClaudeHook } from '../src/events.js';
import { migrateLegacy, normalizePrefs, defaultPrefs, setAlertsSnooze, MAX_SAVED_LOOKS } from '../src/prefs.js';
import { localDay, planRotation, rotationAfterApply, setRotationEnabled, markManualLook } from '../src/rotation.js';

const require = createRequire(import.meta.url);
const { buildClaudeCodeUrl, createDraftStore } = require('../overlay/handoff.cjs');
const { createAlertPlanner } = require('../overlay/alerts.cjs');
const windowState = require('../overlay/window-state.cjs');
const { CATALOG } = require('../overlay/catalog.cjs');

function requestSnapshot(requests, completions = []) {
  return {
    pendingRequestsList: requests,
    recentCompletions: completions,
    sessions: [],
    current: { state: requests.length ? 'needs-you' : 'idle' },
  };
}

test('Claude handoff preserves Unicode, newlines, and literal plus signs', () => {
  const text = 'Fix the + button\nand keep “quotes” 💗';
  const result = buildClaudeCodeUrl(text);
  assert.equal(result.ok, true);
  const url = new URL(result.url);
  assert.equal(url.protocol, 'claude:');
  assert.equal(url.host, 'code');
  assert.equal(url.pathname, '/new');
  assert.equal(url.searchParams.get('q'), text);
  assert.match(result.url, /%2B/);
  assert.match(result.url, /%0A/);
});

test('oversized drafts are rejected instead of truncated', () => {
  const text = 'a'.repeat(5000);
  const result = buildClaudeCodeUrl(text);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TOO_LONG');
  assert.equal(result.url, undefined);
  assert.match(result.error, /Copy it instead/);
  assert.equal(result.draftLength, 5000);
});

test('draft settlement only clears the exact submitted revision', () => {
  const store = createDraftStore('first draft');
  const submitted = store.submit();
  assert.equal(submitted.ok, true);

  store.set('edited while Claude opened');
  const stale = store.settle(submitted);
  assert.equal(stale.cleared, false);
  assert.equal(stale.reason, 'edited');
  assert.equal(store.snapshot().text, 'edited while Claude opened');

  const second = store.submit();
  const settled = store.settle(second);
  assert.equal(settled.cleared, true);
  assert.equal(store.snapshot().text, '');
  assert.equal(store.snapshot().revision > second.revision, true);
});

test('alerts seed on startup, dedupe requests, and never replay suppressed events', () => {
  const planner = createAlertPlanner({ now: () => 1000 });
  const first = requestSnapshot([
    { id: 'p1', sessionId: 'claude:a', kind: 'permission', label: 'Allow Bash?', createdAt: 1 },
  ]);
  assert.equal(planner.ingest(first, { requests: true, completions: true, now: 1000 }).startup, true);
  assert.equal(planner.ingest(first, { requests: true, completions: true, now: 1100 }).notifications.length, 0);

  const second = requestSnapshot([
    { id: 'p1', sessionId: 'claude:a', kind: 'permission', label: 'Allow Bash?', createdAt: 1 },
    { id: 'p2', sessionId: 'claude:b', kind: 'question', label: 'Which branch?', createdAt: 2 },
  ]);
  const delivered = planner.ingest(second, { requests: true, completions: true, now: 1200 });
  assert.equal(delivered.notifications.length, 1);
  assert.equal(delivered.notifications[0].kind, 'request');

  const snoozed = planner.ingest(
    requestSnapshot([
      ...second.pendingRequestsList,
      { id: 'p3', sessionId: 'claude:c', kind: 'permission', label: 'Allow deploy?', createdAt: 3 },
    ]),
    { requests: true, completions: true, now: 1500, snoozeUntil: new Date(5000).toISOString() },
  );
  assert.equal(snoozed.notifications.length, 0);
  assert.equal(snoozed.suppressed, 1);

  const afterSnooze = planner.ingest(
    requestSnapshot([
      ...second.pendingRequestsList,
      { id: 'p3', sessionId: 'claude:c', kind: 'permission', label: 'Allow deploy?', createdAt: 3 },
    ]),
    { requests: true, completions: true, now: 6000 },
  );
  assert.equal(afterSnooze.notifications.length, 0, 'a suppressed request must not burst out later');
});

test('inferred completions never produce completion notifications', () => {
  const planner = createAlertPlanner({ now: () => 1 });
  planner.ingest(requestSnapshot([], []), { requests: true, completions: true, now: 1 });
  const result = planner.ingest(
    requestSnapshot(
      [],
      [
        { key: 'watcher:1', sessionId: 'watcher', observed: 'inferred', message: 'activity settled', at: 2 },
        { key: 'claude:2', sessionId: 'claude:a', observed: 'explicit', message: 'turn finished', at: 3 },
      ],
    ),
    { requests: true, completions: true, now: 4 },
  );
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0].sessionId, 'claude:a');
});

test('legacy wardrobe and overlay settings migrate into v3 preferences', () => {
  const prefs = migrateLegacy({
    wardrobe: {
      outfit: 'princess',
      bow: 'lavender',
      presets: [{ id: 'p1', name: 'Old sleepover', look: { outfit: 'sleepover', bow: 'pink' } }],
    },
    overlay: { idleHobbies: false, sleepAfterMs: 60000 },
  });
  assert.equal(prefs.version, 3);
  assert.equal(prefs.characters.buffy.look.outfit, 'dress');
  assert.equal(prefs.characters.buffy.look.bow, 'lavender');
  assert.equal(prefs.characters.buffy.looks[0].look.outfit, 'overalls');
  assert.equal(prefs.personality.idleHobbies, false);
  assert.equal(prefs.personality.sleepAfterMs, 60000);
  assert.equal(prefs.alerts.requests, false);
  assert.equal(prefs.personality.replyReactions, false);
});

test('preferences saved under the old character id move to buffy', () => {
  const legacy = defaultPrefs();
  legacy.companion.characterId = 'nimbus';
  legacy.characters.nimbus = { ...legacy.characters.buffy, favorites: ['builtin-primrose'] };
  delete legacy.characters.buffy;

  const normalized = normalizePrefs(legacy);
  assert.equal(normalized.companion.characterId, 'buffy');
  assert.deepEqual(normalized.characters.buffy.favorites, ['builtin-primrose']);
  assert.equal(normalized.characters.nimbus, undefined);
});

test('preferences cap saved looks and clear expired snoozes', () => {
  const prefs = defaultPrefs();
  prefs.characters.buffy.looks = Array.from({ length: 40 }, (_, index) => ({
    id: `look-${index}`,
    name: `Look ${index}`,
    look: prefs.characters.buffy.look,
  }));
  prefs.alerts.snoozeUntil = new Date(1000).toISOString();
  const normalized = normalizePrefs(prefs, { now: 2000 });
  assert.equal(normalized.characters.buffy.looks.length, MAX_SAVED_LOOKS);
  assert.equal(normalized.alerts.snoozeUntil, null);
  setAlertsSnooze(normalized, 60 * 60 * 1000, 2000);
  assert.equal(Date.parse(normalized.alerts.snoozeUntil), 2000 + 60 * 60 * 1000);
});

test('daily rotation starts the next day, respects manual looks, and never rerolls', () => {
  const now = new Date(2026, 10, 8, 12, 0, 0).getTime();
  const prefs = defaultPrefs();
  const character = prefs.characters.buffy;
  const enabled = setRotationEnabled(character, true, new Date(2026, 10, 7, 12).getTime());
  enabled.rotation.enabledOn = '2026-11-07';
  prefs.characters.buffy = enabled;

  const plan = planRotation({
    prefs,
    catalog: CATALOG,
    characterId: 'buffy',
    now,
    resting: true,
    isAvailable: () => true,
  });
  assert.equal(plan.rotate, true);
  assert.ok(plan.look);

  const applied = rotationAfterApply({ ...enabled, look: plan.look }, plan, now);
  assert.equal(applied.rotation.lastRotatedDay, localDay(now));
  assert.equal(
    planRotation({
      prefs: { ...prefs, characters: { buffy: applied } },
      catalog: CATALOG,
      characterId: 'buffy',
      now,
      resting: true,
      isAvailable: () => true,
    }).rotate,
    false,
  );

  const manual = markManualLook(enabled, now);
  assert.equal(
    planRotation({
      prefs: { ...prefs, characters: { buffy: manual } },
      catalog: CATALOG,
      characterId: 'buffy',
      now,
      resting: true,
      isAvailable: () => true,
    }).reason,
    'manual',
  );
});

test('window state keeps compact and full positions separate and recovers off-screen', () => {
  const state = windowState.normalizeWindowState({ x: 40, y: 50, compact: { x: 8, y: 9 }, scale: 1.25 });
  assert.deepEqual(state.full, { x: 40, y: 50 });
  assert.deepEqual(state.compact, { x: 8, y: 9 });
  assert.equal(state.scale, 1.25);
  assert.equal(state.migrated, true);

  const compact = windowState.sizeFor('compact', 0.8);
  assert.deepEqual(compact, { width: 187, height: 240 });
  assert.deepEqual(windowState.sizeFor('full', 0.8), { width: 304, height: 520 });
  assert.deepEqual(windowState.sizeFor('full', 1.5), { width: 570, height: 975 });
  assert.deepEqual(windowState.sizeFor('full', 1.75), { width: 665, height: 1138 });
  assert.equal(windowState.normalizeWindowState({ scale: 1.75 }).scale, 1.75);
  assert.equal(windowState.normalizeWindowState({ scale: 2 }).scale, 1);
  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const placed = windowState.placeNearCursor({ x: 1900, y: 1040 }, compact, [display]);
  assert.ok(placed.x >= 0 && placed.x + compact.width <= 1920);
  assert.ok(placed.y >= 0 && placed.y + compact.height <= 1080);
  assert.deepEqual(windowState.clampToDisplay({ x: -50, y: -20, width: 200, height: 200 }, display.workArea), {
    x: 0,
    y: 0,
    width: 200,
    height: 200,
  });
});

test('parallel requests survive unrelated tools and resolve by stable id', () => {
  const machine = createMachine({ doneHoldMs: 30_000, recentCompletionMs: 5 * 60_000 });
  machine.dispatch(
    {
      state: 'needs-you',
      source: 'claude',
      sessionId: 'session-a',
      request: { id: 'perm-1', kind: 'permission', label: 'Allow Bash?', toolName: 'Bash' },
    },
    1000,
  );
  machine.dispatch(
    {
      state: 'needs-you',
      source: 'claude',
      sessionId: 'session-a',
      request: { id: 'perm-2', kind: 'question', label: 'Which branch?', toolName: 'Ask' },
    },
    1001,
  );
  assert.equal(machine.snapshot(1002).pendingRequests, 2);

  const afterUnrelated = machine.dispatch(
    { state: 'working', source: 'claude', sessionId: 'session-a', toolName: 'Read', toolUseId: 'tool-read' },
    1003,
  );
  assert.equal(afterUnrelated.state, 'needs-you');
  assert.equal(afterUnrelated.pendingRequests, 2);

  const afterOne = machine.dispatch(
    { state: 'working', source: 'claude', sessionId: 'session-a', requestId: 'perm-1' },
    1004,
  );
  assert.equal(afterOne.pendingRequests, 1);
  assert.equal(afterOne.message, 'Which branch?');
  assert.equal(afterOne.state, 'needs-you');
});

test('session end clears its own requests without touching another session', () => {
  const machine = createMachine({ doneHoldMs: 30_000 });
  machine.dispatch(
    { state: 'needs-you', sessionId: 'a', request: { id: 'a1', kind: 'permission', label: 'A?' } },
    1,
  );
  machine.dispatch(
    { state: 'needs-you', sessionId: 'b', request: { id: 'b1', kind: 'permission', label: 'B?' } },
    2,
  );
  const ended = machine.dispatch({ state: 'idle', sessionId: 'a', sessionEnded: true, resolveAllRequests: true }, 3);
  assert.equal(ended.pendingRequests, 1);
  assert.equal(ended.pendingRequestsList[0].sessionId, 'b');
});

test('completion presentation, recent completion, and idle reminders are distinct', () => {
  const machine = createMachine({ doneHoldMs: 1000, recentCompletionMs: 5000 });
  machine.dispatch({ state: 'done', sessionId: 'a' }, 1000);
  const recent = machine.snapshot(1100);
  assert.equal(recent.state, 'done');
  assert.equal(recent.recentCompletions.length, 1);

  const reminder = machine.dispatch(
    { state: 'idle', informational: true, category: 'idle-reminder', message: 'waiting', sessionId: 'a' },
    1200,
  );
  assert.equal(reminder.state, 'done');
  assert.equal(reminder.recentCompletions.length, 1);
  assert.equal(reminder.lastIdleReminder.message, 'waiting');

  const expiredPresentation = machine.snapshot(2100);
  assert.equal(expiredPresentation.state, 'idle');
  assert.equal(expiredPresentation.recentCompletions.length, 1);

  const newWork = machine.dispatch({ state: 'working', sessionId: 'a' }, 2200);
  assert.equal(newWork.recentCompletions.length, 0);
});

test('hook normalizer creates explicit requests and resolutions', () => {
  const permission = mapClaudeHook('PermissionRequest', {
    session_id: 's1',
    tool_name: 'Bash',
    permission_request_id: 'permission-1',
    message: 'Allow npm test?',
  });
  assert.equal(permission.state, 'needs-you');
  assert.equal(permission.request.id, 'permission-1');
  assert.equal(permission.sessionId, 's1');

  const post = mapClaudeHook('PostToolUse', {
    session_id: 's1',
    tool_name: 'Bash',
    tool_use_id: 'tool-1',
  });
  assert.deepEqual(post.resolveRequests, ['tool-1']);

  const end = mapClaudeHook('SessionEnd', { session_id: 's1' });
  assert.equal(end.resolveAllRequests, true);
  assert.equal(end.category, 'session-end');
});
