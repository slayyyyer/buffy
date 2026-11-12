import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultPrefs, normalizePrefs } from '../src/prefs.js';

test('both local evidence sources are on by default', () => {
  const prefs = defaultPrefs();
  assert.equal(prefs.connection.freebuffDatabase, true);
  assert.equal(prefs.connection.claudeTranscript, true);
  assert.equal(prefs.connection.freebuffWatcher, true);
});

test('a disabled source stays disabled', () => {
  const prefs = normalizePrefs({
    connection: { freebuffDatabase: false, claudeTranscript: false },
  });
  assert.equal(prefs.connection.freebuffDatabase, false);
  assert.equal(prefs.connection.claudeTranscript, false);
});

test('a missing or malformed switch keeps the source on', () => {
  const prefs = normalizePrefs({ connection: { freebuffDatabase: 'nope', claudeTranscript: null } });
  assert.equal(prefs.connection.freebuffDatabase, true);
  assert.equal(prefs.connection.claudeTranscript, true);
  assert.equal(normalizePrefs({}).connection.freebuffDatabase, true);
  assert.equal(normalizePrefs({}).connection.claudeTranscript, true);
});

test('the switches survive a round trip with other preferences', () => {
  const prefs = normalizePrefs({
    connection: { freebuffWatcher: false, freebuffDatabase: false, claudeTranscript: true },
    companion: { name: 'Mochi' },
  });
  assert.equal(prefs.connection.freebuffWatcher, false);
  assert.equal(prefs.connection.freebuffDatabase, false);
  assert.equal(prefs.connection.claudeTranscript, true);
  assert.equal(prefs.companion.name, 'Mochi');
});
