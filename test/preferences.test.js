import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultPrefs, normalizePrefs } from '../src/prefs.js';

test('both local evidence sources are on by default', () => {
  const prefs = defaultPrefs();
  assert.equal(prefs.connection.freebuffDatabase, true);
  assert.equal(prefs.connection.claudeTranscript, true);
  assert.equal(prefs.connection.freebuffWatcher, true);
  assert.equal(prefs.privacy.hideFromCapture, true, 'she stays out of capture by default');
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

test('capture exclusion defaults on and only an explicit false turns it off', () => {
  assert.equal(normalizePrefs({}).privacy.hideFromCapture, true);
  assert.equal(normalizePrefs({ privacy: {} }).privacy.hideFromCapture, true);
  assert.equal(normalizePrefs({ privacy: { hideFromCapture: 'nope' } }).privacy.hideFromCapture, true);
  assert.equal(normalizePrefs({ privacy: { hideFromCapture: false } }).privacy.hideFromCapture, false);
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
