/* global globalThis */
/**
 * Pose hysteresis for the overlay.
 *
 * Events arrive at tool boundaries: PreToolUse then PostToolUse a few hundred
 * milliseconds apart. Drawing each new pose immediately makes the art strobe.
 * A pose is therefore adopted only after it persists for `confirmMs`, and the
 * pose already on screen is held for at least `minHoldMs`. A calmer pose also
 * cannot interrupt a louder one within `minHoldMs * 3`, so a finished tool
 * never wipes a celebration that just started.
 */
(function poseSmoother() {
  'use strict';

  const WEIGHTS = {
    celebrate: 9,
    flustered: 8,
    tapping: 7,
    squish: 6,
    waiting: 5,
    reading: 4,
    typingLeft: 4,
    typingRight: 4,
    happy: 3,
    wave: 2,
    tea: 2,
    gardening: 2,
    sleepy: 1,
    idle: 1,
  };

  function weightFor(pose) {
    return WEIGHTS[pose] ?? 1;
  }

  function createPoseSmoother({ confirmMs = 250, minHoldMs = 380 } = {}) {
    const confirm = Math.max(0, Number(confirmMs) || 0);
    const minHold = Math.max(0, Number(minHoldMs) || 0);
    let current = null;
    let adoptedAt = 0;
    let pending = null;
    let pendingSince = 0;

    function adopt(pose, at) {
      current = pose;
      adoptedAt = at;
      pending = null;
      return current;
    }

    function push(pose, now = Date.now()) {
      const next = pose || 'idle';
      const at = Number.isFinite(now) ? now : 0;
      if (!current) return adopt(next, at);
      if (next === current) {
        pending = null;
        return current;
      }

      if (pending !== next) {
        pending = next;
        pendingSince = at;
      }
      if (at - pendingSince < confirm) return current;
      if (at - adoptedAt < minHold) return current;
      if (weightFor(next) < weightFor(current) && at - adoptedAt < minHold * 3) return current;
      return adopt(next, at);
    }

    function reset(pose = null, now = 0) {
      return adopt(pose, now);
    }

    return { push, reset, current: () => current };
  }

  globalThis.BuffyPoses = { createPoseSmoother, weightFor, WEIGHTS };
})();
