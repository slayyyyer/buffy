'use strict';

/**
 * Notification delivery planning. Kept outside Electron so deduplication,
 * startup suppression and snooze behavior can be tested directly.
 *
 * The planner always marks an event as seen, even when notifications are
 * disabled or snoozed. Suppressed events therefore never burst out later.
 */
function createAlertPlanner({ now = Date.now } = {}) {
  let initialized = false;
  const seenRequests = new Set();
  const seenCompletions = new Set();
  let snoozedUntil = null;

  function requestKey(request) {
    return `${request.sessionId || 'session'}:${request.id || `${request.kind}:${request.createdAt}`}`;
  }

  function completionKey(completion) {
    return completion.key || `${completion.sessionId}:${completion.at}`;
  }

  function seed(snapshot) {
    for (const request of snapshot?.pendingRequestsList || snapshot?.requests || []) {
      seenRequests.add(requestKey(request));
    }
    for (const completion of snapshot?.recentCompletions || []) {
      seenCompletions.add(completionKey(completion));
    }
    initialized = true;
  }

  /**
   * @returns {{notifications: Array, sounds: number, suppressed: number, snoozed: boolean}}
   */
  function ingest(snapshot, options = {}) {
    const at = options.now ?? now();
    const requestsEnabled = options.requests === true;
    const completionsEnabled = options.completions === true;
    const soundsEnabled = options.sounds === true;
    const snooze = options.snoozeUntil ? Date.parse(options.snoozeUntil) : NaN;
    const snoozed = Number.isFinite(snooze) && snooze > at;
    snoozedUntil = snoozed ? options.snoozeUntil : null;

    if (!initialized) {
      seed(snapshot);
      return { notifications: [], sounds: 0, suppressed: 0, snoozed, startup: true };
    }

    const notifications = [];
    let suppressed = 0;

    const pending = snapshot?.pendingRequestsList || [];
    for (const request of pending) {
      const key = requestKey(request);
      if (seenRequests.has(key)) continue;
      seenRequests.add(key);
      if (snoozed || !requestsEnabled) {
        suppressed += 1;
        continue;
      }
      notifications.push({
        kind: 'request',
        title: request.kind === 'permission' ? 'Claude needs permission' : 'Claude has a question',
        body: request.label || 'A coding agent is waiting for you.',
        sessionId: request.sessionId,
        requestId: request.id,
        key,
      });
    }

    const recent = snapshot?.recentCompletions || [];
    for (const completion of recent) {
      const key = completionKey(completion);
      if (seenCompletions.has(key)) continue;
      seenCompletions.add(key);
      if (completion.observed === 'inferred') {
        suppressed += 1;
        continue;
      }
      if (snoozed || !completionsEnabled) {
        suppressed += 1;
        continue;
      }
      notifications.push({
        kind: 'completion',
        title: 'Claude finished a turn',
        body: completion.message || 'The agent finished responding.',
        sessionId: completion.sessionId,
        key,
      });
    }

    if (notifications.length > 40) notifications.splice(0, notifications.length - 40);
    return {
      notifications,
      sounds: notifications.length && soundsEnabled ? Math.min(2, notifications.length) : 0,
      suppressed,
      snoozed,
    };
  }

  function reset() {
    initialized = false;
    seenRequests.clear();
    seenCompletions.clear();
    snoozedUntil = null;
  }

  return {
    ingest,
    reset,
    seed,
    get initialized() {
      return initialized;
    },
    get snoozedUntil() {
      return snoozedUntil;
    },
    get seenCount() {
      return seenRequests.size + seenCompletions.size;
    },
  };
}

module.exports = { createAlertPlanner };
