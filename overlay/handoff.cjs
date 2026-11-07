'use strict';

/**
 * Claude Desktop handoff.
 *
 * Documented scheme: claude://code/new?q=<encoded prompt>. `q` pre-fills the
 * composer; the user still reviews and sends it. A successful OS launch only
 * proves that the app link was handed to the operating system.
 *
 * The documented prompt limit is roughly 14,000 characters, but the encoded
 * URL crosses platforms with different command-line ceilings, so Buffy uses a
 * deliberately smaller portable limit and never truncates a draft.
 */
const CLAUDE_CODE_BASE = 'claude://code/new';
const DEFAULT_MAX_URL_LENGTH = 4000;

function buildClaudeCodeUrl(text, { maxUrlLength = DEFAULT_MAX_URL_LENGTH } = {}) {
  const raw = String(text ?? '');
  if (!raw.trim()) {
    return { ok: false, code: 'EMPTY', error: 'Write something first.' };
  }
  const encoded = encodeURIComponent(raw);
  const url = `${CLAUDE_CODE_BASE}?q=${encoded}`;
  const limit = Math.max(256, Number(maxUrlLength) || DEFAULT_MAX_URL_LENGTH);
  if (url.length > limit) {
    return {
      ok: false,
      code: 'TOO_LONG',
      error: `That draft is too long for a secure app link (${url.length} encoded characters; limit ${limit}). Copy it instead.`,
      urlLength: url.length,
      encodedLength: encoded.length,
      limit,
      draftLength: raw.length,
    };
  }
  return {
    ok: true,
    url,
    urlLength: url.length,
    encodedLength: encoded.length,
    limit,
    draftLength: raw.length,
  };
}

/** Authoritative draft lifecycle for the main process. Never writes to disk. */
function createDraftStore(initial = '') {
  let text = String(initial ?? '');
  let revision = 0;
  let handoffSeq = 0;

  function snapshot() {
    return { text, revision, length: text.length };
  }

  function set(next) {
    const value = String(next ?? '');
    if (value === text) return snapshot();
    text = value;
    revision += 1;
    return snapshot();
  }

  function submit() {
    if (!text.trim()) return { ok: false, code: 'EMPTY', error: 'Write something first.' };
    handoffSeq += 1;
    return {
      ok: true,
      text,
      revision,
      handoffId: handoffSeq,
      draft: buildClaudeCodeUrl(text),
    };
  }

  /**
   * Clear only when the submitted text is still the current draft and no edit
   * happened while the OS handoff was in flight.
   */
  function settle(handoff) {
    if (!handoff || handoff.handoffId !== handoffSeq) {
      return { cleared: false, reason: 'superseded', draft: snapshot() };
    }
    if (handoff.revision !== revision || handoff.text !== text) {
      return { cleared: false, reason: 'edited', draft: snapshot() };
    }
    text = '';
    revision += 1;
    return { cleared: true, reason: 'cleared', draft: snapshot() };
  }

  return {
    snapshot,
    set,
    submit,
    settle,
    get text() {
      return text;
    },
    get revision() {
      return revision;
    },
  };
}

module.exports = {
  CLAUDE_CODE_BASE,
  DEFAULT_MAX_URL_LENGTH,
  buildClaudeCodeUrl,
  createDraftStore,
};
