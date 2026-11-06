/* global globalThis */
(function hobbyModule() {
  'use strict';

  const HOBBIES = [
    { id: 'reading', label: 'Reading', durationMs: 20000 },
    { id: 'coffee', label: 'Coffee', durationMs: 16000 },
    { id: 'stretch', label: 'Stretch', durationMs: 7000 },
  ];

  const DEFAULTS = {
    firstDelayMs: 8000,
    gapMs: 9000,
    sleepAfterMs: 120000,
    idleHobbies: true,
  };

  function createHobbyScheduler(options = {}) {
    const random = typeof options.random === 'function' ? options.random : Math.random;
    let idleHobbies = options.idleHobbies !== false;
    let sleepAfterMs = Number.isFinite(options.sleepAfterMs) ? options.sleepAfterMs : DEFAULTS.sleepAfterMs;
    const firstDelayMs = Number.isFinite(options.firstDelayMs) ? options.firstDelayMs : DEFAULTS.firstDelayMs;
    const gapMs = Number.isFinite(options.gapMs) ? options.gapMs : DEFAULTS.gapMs;
    let lastActivityAt = Number.isFinite(options.now) ? options.now : 0;
    let nextAt = lastActivityAt + firstDelayMs;
    let asleep = false;
    let current = null;
    let lastId = null;

    function reset(now) {
      lastActivityAt = now;
      asleep = false;
      current = null;
      nextAt = now + firstDelayMs;
    }

    function update(now, input = {}) {
      const hovered = input.hovered === true;
      const busy = input.busy === true;
      if (hovered || busy) {
        if (hovered && current) lastId = current.id;
        reset(now);
        return null;
      }

      if (current && now >= current.endsAt) {
        lastId = current.id;
        current = null;
        nextAt = now + gapMs;
      }
      if (current) return current;
      if (asleep) return null;
      if (now - lastActivityAt >= sleepAfterMs) {
        asleep = true;
        return null;
      }
      if (!idleHobbies || now < nextAt) return null;

      let pick;
      if (lastId) {
        const index = HOBBIES.findIndex((hobby) => hobby.id === lastId);
        pick = HOBBIES[(index + 1) % HOBBIES.length] || HOBBIES[0];
      } else {
        pick = HOBBIES[Math.min(HOBBIES.length - 1, Math.floor(random() * HOBBIES.length))];
      }
      current = { id: pick.id, startedAt: now, endsAt: now + pick.durationMs, durationMs: pick.durationMs };
      return current;
    }

    function activity(now) {
      if (current) lastId = current.id;
      reset(now);
    }

    function isAsleep() {
      return asleep;
    }

    function configure(patch = {}) {
      if (typeof patch.idleHobbies === 'boolean') idleHobbies = patch.idleHobbies;
      if (Number.isFinite(patch.sleepAfterMs)) sleepAfterMs = patch.sleepAfterMs;
      if (!idleHobbies) current = null;
    }

    return { update, activity, isAsleep, configure };
  }

  globalThis.BuffyHobbies = { HOBBIES, DEFAULTS, createHobbyScheduler };
})();
