/* global window, document, performance, requestAnimationFrame */
(function main() {
  'use strict';

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const bubbleEl = document.getElementById('bubble');
  const textEl = document.getElementById('text');
  const sourceEl = document.getElementById('source');
  const sessionsEl = document.getElementById('sessions');
  const WAVE_MS = 1800;
  const WAKE_MS = 900;
  const WARDROBE_DEFAULTS = { outfit: 'princess', bow: 'none', hat: 'none', glasses: 'none', wand: 'none', theme: 'rose' };

  const DEFAULT_MESSAGES = {
    'needs-you': 'I need you for something.',
    done: 'Done! Nice one.',
    error: 'Something broke.',
    thinking: 'Thinking…',
    working: 'Working…',
  };

  // Buffy's default look: a pink princess-cloud mascot with a pixel-screen face.
  let snapshot = null;
  let offline = false;
  let lastKey = '';
  let waveAt = 0;
  let wakeAt = 0;
  let cursorLocal = null;
  let cursorInside = false;
  let gazeX = 0;
  let gazeY = 0;
  let wardrobe = { ...WARDROBE_DEFAULTS };
  let dragTrail = [];
  let bubbleUntil = 0;
  let currentSessions = [];
  let lastSessionsKey = '';
  let customImage = null;
  let customImageKey = '';
  let overlaySettings = { idleHobbies: true, sleepAfterMs: 120000 };
  let demoHobby = null;
  const scheduler = BuffyHobbies.createHobbyScheduler({ now: performance.now(), ...overlaySettings });

  // Keep in sync with src/palette.js. Duplicated because file:// pages cannot
  // import ES modules without a custom protocol.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function paletteFromSeed(seed) {
    const rand = mulberry32(seed);
    const hue = Math.floor(rand() * 360);
    const hue2 = (hue + 40 + Math.floor(rand() * 80)) % 360;
    const variant = Math.floor(rand() * 3);
    return { hue, hue2, variant };
  }

  function applyWardrobe(next) {
    wardrobe = { ...WARDROBE_DEFAULTS, ...(next && typeof next === 'object' ? next : {}) };
  }

  applyWardrobe(WARDROBE_DEFAULTS);

  function currentPalette() {
    const sprite = snapshot && snapshot.pet && snapshot.pet.sprite;
    const seed = (sprite && sprite.seed) || (snapshot && snapshot.pet && snapshot.pet.seed) || 7;
    const fallback = paletteFromSeed(seed);
    const variant = sprite && sprite.palette && Number.isFinite(sprite.palette.variant)
      ? sprite.palette.variant
      : fallback.variant;
    return { ...BuffyCharacter.paletteFor(wardrobe.theme), variant };
  }

  function syncSpriteImage(sprite, port) {
    const key = sprite && sprite.type === 'image' ? `${sprite.id || sprite.file}|${port || ''}` : '';
    if (key === customImageKey) return;
    customImageKey = key;
    customImage = null;
    if (!key || !port) return;

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (customImageKey === key) customImage = image;
    };
    image.src = `http://127.0.0.1:${port}/sprite?v=${encodeURIComponent(sprite.id || Date.now())}`;
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    positionSessions();
  }

  window.addEventListener('resize', resize);
  resize();

  function positionSessions() {
    if (!sessionsEl) return;
    const bubbleVisible = !bubbleEl.classList.contains('hidden');
    const top = bubbleVisible ? bubbleEl.offsetTop + bubbleEl.offsetHeight + 6 : 8;
    sessionsEl.style.top = `${top}px`;
  }

  function showBubble(text, source, state, durationMs, agents = 1) {
    if (!text) return;
    textEl.textContent = text;
    const label = source ? String(source).slice(0, 18) : '';
    sourceEl.textContent = agents > 1
      ? `${label ? `${label} · ` : ''}${agents} agents`.slice(0, 32)
      : label;
    bubbleEl.classList.remove('hidden');
    const sticky = state === 'needs-you' || state === 'error';
    bubbleUntil = sticky ? Infinity : performance.now() + (durationMs || 6500);
    positionSessions();
  }

  function hideBubble() {
    bubbleEl.classList.add('hidden');
    bubbleUntil = 0;
    positionSessions();
  }

  function sessionLabel(session) {
    const source = String(session.source || 'agent').slice(0, 24);
    const id = String(session.id || '');
    if (!id || id === source) return source;
    const short = id.includes(':') ? id.split(':').slice(1).join(':') : id;
    return `${source} · ${short.slice(0, 7)}`;
  }

  function sessionAge(session) {
    const at = Number(session.updatedAt || session.since || Date.now());
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (seconds < 10) return 'now';
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h`;
  }

  function renderSessions(sessions, force = false) {
    currentSessions = Array.isArray(sessions) ? sessions : [];
    const visible = currentSessions.length > 1;
    sessionsEl.classList.toggle('hidden', !visible);
    if (!visible) {
      sessionsEl.replaceChildren();
      lastSessionsKey = '';
      positionSessions();
      return;
    }

    const key = `${currentSessions.map((session) => `${session.id}|${session.state}|${session.message}|${session.seq}`).join('~')}|${Math.floor(Date.now() / 30_000)}`;
    if (!force && key === lastSessionsKey) {
      positionSessions();
      return;
    }
    lastSessionsKey = key;

    const shown = currentSessions.slice(0, 3);
    const fragment = document.createDocumentFragment();
    for (const session of shown) {
      const label = sessionLabel(session);
      const row = document.createElement('div');
      row.className = 'session';
      row.dataset.state = session.state || 'idle';
      row.title = `${session.id} — ${session.state}${session.message ? `: ${session.message}` : ''}`;

      const dot = document.createElement('span');
      dot.className = 'session-dot';
      dot.setAttribute('aria-hidden', 'true');

      const name = document.createElement('span');
      name.className = 'session-name';
      name.textContent = label;

      const state = document.createElement('span');
      state.className = 'session-state';
      state.textContent = String(session.state || 'idle').replace('-', ' ');

      const age = document.createElement('span');
      age.className = 'session-age';
      age.textContent = sessionAge(session);

      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'session-dismiss';
      dismiss.dataset.session = session.id;
      dismiss.setAttribute('aria-label', `Dismiss ${label}`);
      dismiss.title = `Dismiss ${label}`;
      dismiss.textContent = '×';

      row.append(dot, name, state, age, dismiss);
      fragment.append(row);
    }

    if (currentSessions.length > shown.length) {
      const more = document.createElement('div');
      more.className = 'session-more';
      more.textContent = `+${currentSessions.length - shown.length} more active`;
      fragment.append(more);
    }

    sessionsEl.replaceChildren(fragment);
    positionSessions();
  }

  sessionsEl.addEventListener('pointerdown', (event) => event.stopPropagation());
  sessionsEl.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-session]');
    if (!button) return;
    event.stopPropagation();
    button.disabled = true;
    button.textContent = '…';
    Promise.resolve(window.buffy.dismissSession(button.dataset.session)).catch(() => {
      button.disabled = false;
      button.textContent = '×';
    });
  });

  setInterval(() => {
    if (currentSessions.length) renderSessions(currentSessions, true);
  }, 15_000);

  function applySnapshot(next) {
    if (!next) return;
    const now = performance.now();
    const wasSleepy = stateAt(now) === 'sleepy';
    offline = false;
    snapshot = next;
    syncSpriteImage(next.pet && next.pet.sprite, next.port);
    const current = next.current || {};
    const sessions = Array.isArray(next.sessions)
      ? next.sessions
      : Array.isArray(current.sessions)
        ? current.sessions
        : [];
    const agents = sessions.length;
    const needsCount = sessions.filter((session) => session.state === 'needs-you').length;
    let message = current.message || DEFAULT_MESSAGES[current.state] || null;
    if (message && needsCount > 1) message = `${message} (+${needsCount - 1} more need you)`;
    const key = `${current.seq || 0}|${current.state || 'idle'}|${message || ''}|${agents}`;
    if (key !== lastKey) {
      lastKey = key;
      scheduler.activity(now);
      if (wasSleepy) wakeAt = now;
      if (message) showBubble(message, current.source, current.state, undefined, agents);
      else hideBubble();
    }
    renderSessions(sessions);
  }

  window.buffy.onState((payload) => {
    if (!payload) {
      offline = true;
      return;
    }
    applySnapshot(payload);
  });

  function baseState() {
    return (snapshot && snapshot.current && snapshot.current.state) || 'idle';
  }

  function sleepDue(now) {
    return baseState() === 'idle' && scheduler.isAsleep(now);
  }

  function stateAt(now) {
    if (offline) return 'offline';
    if (now - waveAt < WAVE_MS) return 'wave';
    const base = baseState();
    if (base !== 'idle') return base;
    if (now - wakeAt < WAKE_MS) return 'wake';
    if (sleepDue(now) && !cursorInside) return 'sleepy';
    return base;
  }

  function wakeUp(now = performance.now()) {
    const wasSleepy = sleepDue(now) && !cursorInside;
    scheduler.activity(now);
    if (wasSleepy) wakeAt = now;
  }

  function waveIt() {
    const now = performance.now();
    wakeUp(now);
    waveAt = now;
    showBubble('Hi!', 'you', 'wave', WAVE_MS);
  }

  window.buffy.onPetRequest(() => waveIt());

  window.buffy.onCursor((point) => {
    if (!point) return;
    const now = performance.now();
    const inside = point.x >= 0 && point.x <= window.innerWidth && point.y >= 0 && point.y <= window.innerHeight;
    const wasSleepy = sleepDue(now) && !cursorInside;
    cursorLocal = point;
    cursorInside = inside;
    if (inside) {
      scheduler.activity(now);
      if (wasSleepy) wakeAt = now;
    }
  });

  window.buffy.onWardrobe((next) => applyWardrobe(next));

  window.buffy.onSettings((next) => {
    overlaySettings = { ...overlaySettings, ...(next || {}) };
    scheduler.configure(overlaySettings);
  });

  window.buffy.onDemoHobby((id) => {
    const now = performance.now();
    demoHobby = id ? { id, startedAt: now - 1000, endsAt: now + 60000 } : null;
  });


  function spawnDragTrail(moveX, moveY) {
    const now = performance.now();
    const width = window.innerWidth;
    const height = window.innerHeight;
    const side = Math.abs(moveX) > 1 ? -Math.sign(moveX) : (Math.random() < 0.5 ? -1 : 1);
    const kind = Math.random() < 0.55 ? 'heart' : 'sparkle';
    const mascot = BuffyCharacter.colors(wardrobe);
    const palette = kind === 'heart'
      ? [mascot.pink, '#ff9bcb', mascot.pinkDeep]
      : [mascot.gold, mascot.cream, mascot.blueLight];

    dragTrail.push({
      kind,
      x: width / 2 + side * (42 + Math.random() * 16),
      y: height - 95 + (Math.random() - 0.5) * 55 - Math.sign(moveY || 0) * 10,
      vx: Math.max(-30, Math.min(30, -moveX * 0.35)) + (Math.random() - 0.5) * 4,
      vy: -9 - Math.random() * 10 - Math.max(-10, Math.min(10, moveY * 0.25)),
      size: 2.8 + Math.random() * 2.4,
      color: palette[Math.floor(Math.random() * palette.length)],
      bornAt: now,
      ttl: 480 + Math.random() * 280,
      phase: Math.random() * Math.PI * 2,
    });

    if (dragTrail.length > 48) dragTrail.splice(0, dragTrail.length - 48);
  }

  function drawDragTrail(now) {
    if (!dragTrail.length) return;
    dragTrail = dragTrail.filter((particle) => now - particle.bornAt < particle.ttl);
    dragTrail.forEach((particle) => {
      const progress = (now - particle.bornAt) / particle.ttl;
      const ease = 1 - (1 - progress) * (1 - progress);
      const x = particle.x + particle.vx * ease;
      const y = particle.y + particle.vy * ease;
      const alpha = (1 - progress) * 0.7;

      if (particle.kind === 'heart') {
        BuffyCharacter.drawHeart(x, y, particle.size * (0.8 + (1 - progress) * 0.25), alpha, particle.color);
      } else {
        const twinkle = 0.65 + 0.35 * Math.sin(now / 90 + particle.phase);
        BuffyCharacter.drawSparkle(x, y, particle.size * (0.9 + 0.2 * twinkle), particle.color, alpha * twinkle);
      }
    });
  }


  function drawPet(now, state, hobby) {
    BuffyCharacter.draw(ctx, {
      now,
      state,
      look: wardrobe,
      width: window.innerWidth,
      height: window.innerHeight,
      customImage,
      cursor: cursorLocal,
      wakeAt,
      hobby,
    });
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const width = window.innerWidth;
    const height = window.innerHeight;
    ctx.clearRect(0, 0, width, height);
    const base = baseState();
    const hobby = scheduler.update(now, { hovered: cursorInside, busy: offline || base !== 'idle' });
    const state = stateAt(now);
    drawPet(now, state, state === 'idle' ? (demoHobby || hobby) : null);
    drawDragTrail(now);
    if (bubbleUntil && now > bubbleUntil) hideBubble();
  }

  requestAnimationFrame(frame);

  // Drag vs. click: a few pixels of movement means drag, otherwise pet.
  let pointer = null;

  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    wakeUp();
    cursorInside = true;
    cursorLocal = { x: event.clientX, y: event.clientY };
    pointer = {
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      lastTrailAt: 0,
      moved: false,
    };
    window.buffy.dragStart(event.screenX, event.screenY);
  });

  document.addEventListener('pointermove', (event) => {
    wakeUp();
    cursorInside = true;
    cursorLocal = { x: event.clientX, y: event.clientY };
    if (!pointer) return;

    const now = performance.now();
    const moveX = event.screenX - pointer.lastX;
    const moveY = event.screenY - pointer.lastY;
    pointer.lastX = event.screenX;
    pointer.lastY = event.screenY;

    if (!pointer.moved && Math.hypot(event.screenX - pointer.startX, event.screenY - pointer.startY) > 4) {
      pointer.moved = true;
      document.body.classList.add('dragging');
    }

    if (pointer.moved) {
      if (now - pointer.lastTrailAt > 32 && (moveX !== 0 || moveY !== 0)) {
        spawnDragTrail(moveX, moveY);
        pointer.lastTrailAt = now;
      }
      window.buffy.dragMove(event.screenX, event.screenY);
    }
  });

  document.addEventListener('pointerleave', () => {
    cursorInside = false;
  });

  document.addEventListener('pointerup', () => {
    if (!pointer) return;
    const moved = pointer.moved;
    pointer = null;
    document.body.classList.remove('dragging');
    window.buffy.dragEnd();
    if (!moved) waveIt();
  });

  document.addEventListener('pointercancel', () => {
    pointer = null;
    document.body.classList.remove('dragging');
    window.buffy.dragEnd();
  });

  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    window.buffy.menu();
  });
})();
