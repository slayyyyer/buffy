/* global window, document, Image, globalThis, BuffyCharacter */
(function characterSystem() {
  'use strict';

  const MANIFEST = globalThis.BUFFY_MANIFEST || { characters: [] };
  const cache = new Map();
  const THEMES = {
    plum: { accent: '#c87b9f', glow: 'rgba(122, 57, 92, 0.2)', filter: null },
    rose: { accent: '#e78bb0', glow: 'rgba(231, 139, 176, 0.2)', filter: 'hue-rotate(-6deg) saturate(1.04)' },
    lavender: { accent: '#a58cc9', glow: 'rgba(165, 140, 201, 0.2)', filter: 'hue-rotate(-26deg) saturate(0.95)' },
    mint: { accent: '#7fbfa4', glow: 'rgba(127, 191, 164, 0.18)', filter: 'hue-rotate(58deg) saturate(0.82)' },
    sky: { accent: '#7fb3d9', glow: 'rgba(127, 179, 217, 0.2)', filter: 'hue-rotate(128deg) saturate(0.86)' },
    butter: { accent: '#d9b061', glow: 'rgba(217, 176, 97, 0.2)', filter: 'hue-rotate(24deg) saturate(1.08)' },
    midnight: { accent: '#a99ad8', glow: 'rgba(80, 63, 115, 0.28)', filter: 'hue-rotate(186deg) saturate(0.82) brightness(0.9)' },
  };

  function manifest() {
    return MANIFEST;
  }

  function getCharacter(id) {
    return MANIFEST.characters.find((character) => character.id === id) || MANIFEST.characters[0];
  }

  function assetList(character) {
    const list = [];
    if (character.renderer === 'atlas') {
      if (character.atlas) list.push(character.atlas);
    } else {
      if (character.base) list.push(character.base);
      for (const file of Object.values(character.poses || {})) list.push(file);
    }
    for (const file of Object.values(character.outfitAssets || {})) list.push(file);
    for (const slot of Object.values(character.accessoryAssets || {})) {
      for (const file of Object.values(slot || {})) list.push(file);
    }
    return [...new Set(list.filter(Boolean))];
  }

  function entry(characterId) {
    const id = characterId || getCharacter(characterId)?.id;
    if (!cache.has(id)) {
      cache.set(id, { id, images: new Map(), failed: new Set(), ready: false, loading: null });
    }
    return cache.get(id);
  }

  function loadImage(rel) {
    return new Promise((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve({ ok: true, image });
      image.onerror = () => resolve({ ok: false });
      image.src = `characters/${rel}`;
    });
  }

  function preload(characterId) {
    const character = getCharacter(characterId);
    const state = entry(character.id);
    if (state.ready) return Promise.resolve(state);
    if (state.loading) return state.loading;
    state.loading = Promise.all(
      assetList(character).map(async (rel) => {
        const result = await loadImage(rel);
        if (result.ok) state.images.set(rel, result.image);
        else state.failed.add(rel);
      }),
    ).then(() => {
      state.ready = true;
      state.loading = null;
      return state;
    });
    return state.loading;
  }

  function isReady(characterId) {
    return entry(characterId).ready;
  }

  function missingAssets(characterId) {
    return [...entry(characterId).failed];
  }

  function imageFor(characterId, rel) {
    if (!rel) return null;
    return entry(characterId).images.get(rel) || null;
  }

  function availableChecker(characterId) {
    const state = entry(characterId);
    return (rel) => Boolean(rel && state.images.has(rel) && !state.failed.has(rel));
  }

  function themeOf(theme) {
    return THEMES[theme] || THEMES.plum;
  }

  function themeAccent(theme) {
    return themeOf(theme).accent;
  }

  // The five reaction poses have hand-drawn art on Buffy only. Atlas companions
  // keep their nine cells, so the body borrows the closest mood while the
  // reaction's own effects are still drawn over it (see draw()).
  const ATLAS_FALLBACK = {
    flustered: 'idle',
    tapping: 'idle',
    squish: 'typingLeft',
    waiting: 'sleepy',
    celebrate: 'happy',
  };

  function atlasPose(pose) {
    return ATLAS_FALLBACK[pose] || pose;
  }

  function poseFor({
    state = 'idle',
    category = 'thinking',
    hobby = null,
    greeting = false,
    waiting = false,
    celebration = false,
  } = {}) {
    if (state === 'error') return 'flustered';
    if (state === 'needs-you') return 'tapping';
    if (celebration) return 'celebrate';
    if (greeting) return 'wave';
    if (state === 'done' || state === 'hello') return 'happy';
    if (state === 'working') {
      if (category === 'compacting') return 'squish';
      if (waiting) return 'waiting';
      if (category === 'reading' || category === 'searching') return 'reading';
      return 'typingLeft';
    }
    if (state === 'sleepy') return 'sleepy';
    if (state === 'idle' && hobby) {
      if (hobby.id === 'reading') return 'reading';
      if (hobby.id === 'coffee' || hobby.id === 'tea') return 'tea';
      if (hobby.id === 'gardening') return 'gardening';
      if (hobby.id === 'stretch') return 'happy';
    }
    return 'idle';
  }

  function typingPose(now, category) {
    if (category === 'reading' || category === 'searching') return 'reading';
    return Math.floor(now / 260) % 2 === 0 ? 'typingLeft' : 'typingRight';
  }

  function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  function drawSparkle(ctx, x, y, size, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI / 4) * i;
      const radius = i % 2 === 0 ? size : size * 0.35;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawHeart(ctx, x, y, size, alpha, color) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.7);
    ctx.bezierCurveTo(x - size * 1.4, y - size * 0.35, x - size * 0.4, y - size, x, y - size * 0.35);
    ctx.bezierCurveTo(x + size * 0.4, y - size, x + size * 1.4, y - size * 0.35, x, y + size * 0.7);
    ctx.fill();
    ctx.restore();
  }

  function drawLegacy(ctx, options) {
    if (!globalThis.BuffyCharacter) return;
    const legacyOutfit = {
      dress: 'princess',
      cozy: 'cozy',
      rainy: 'rainy',
      starlight: 'starlight',
      overalls: 'sleepover',
    };
    const look = {
      ...options.look,
      outfit: legacyOutfit[options.look?.outfit] || 'princess',
    };
    globalThis.BuffyCharacter.draw(ctx, {
      now: options.now,
      state: options.state === 'sleepy' ? 'idle' : options.state,
      look,
      width: options.width,
      height: options.height,
      baseY: options.baseY,
      scale: options.scale,
      customImage: options.customImage || null,
      cursor: options.cursor,
      wakeAt: 0,
      hobby: options.hobby,
      compact: options.compact,
    });
  }

  function drawPlaceholder(ctx, options) {
    const { width, height, now = 0, baseY = height } = options;
    const heightBox = Math.min(height * 0.72, width * 0.95);
    const centerX = width / 2;
    const centerY = baseY - heightBox / 2;
    ctx.save();
    const bob = Math.sin(now / 900) * 2;
    ctx.translate(centerX, centerY + bob);
    const gradient = ctx.createRadialGradient(-heightBox * 0.16, -heightBox * 0.2, 8, 0, 0, heightBox * 0.5);
    gradient.addColorStop(0, '#fff6ea');
    gradient.addColorStop(0.7, '#f3cfcc');
    gradient.addColorStop(1, '#e2adb7');
    ctx.fillStyle = gradient;
    ctx.strokeStyle = '#5c3150';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(0, 0, heightBox * 0.42, heightBox * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#3a2039';
    roundRect(ctx, -heightBox * 0.2, -heightBox * 0.1, heightBox * 0.4, heightBox * 0.2, 14);
    ctx.fill();
    ctx.fillStyle = '#ffc7dd';
    ctx.font = `700 ${Math.round(heightBox * 0.09)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('…', 0, -heightBox * 0.005);
    ctx.restore();
  }

  function drawFace(ctx, { x, y, width, height, state, pose = null, blink, gazeX, gazeY, hobby, reducedMotion, now = 0, stateSince = 0 }) {
    // The default character has a dark plush screen, so the face is drawn in
    // warm light ink with a dark pupil. Dark ink vanished into the screen.
    const ink = '#ffe9f3';
    const pupil = '#432340';
    const pink = '#ff9ccc';
    const white = '#ffffff';
    const eyeY = y - height * 0.07;
    const eyeGap = width * 0.19;
    const eyeW = width * 0.092;
    const eyeH = height * 0.19;
    const mouthY = y + height * 0.23;

    ctx.save();
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = Math.max(2, width * 0.028);
    ctx.lineCap = 'round';

    const happy = state === 'done' || state === 'hello' || state === 'wave' || hobby || pose === 'celebrate';
    const sleepy = state === 'sleepy';
    const error = state === 'error';
    const offline = state === 'offline';
    const attention = state === 'needs-you';
    const flustered = pose === 'flustered' || error;
    const squished = pose === 'squish';
    const waitingPose = pose === 'waiting';
    const tappingPose = pose === 'tapping';
    const celebrating = pose === 'celebrate';
    const helloAge = state === 'hello' ? Math.max(0, now - stateSince) : -1;

    const lashFlicks = (cx, baseY, side, scale = 1) => {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 182, 214, 0.92)';
      ctx.lineWidth = Math.max(1, width * 0.008);
      for (let i = 0; i < 3; i += 1) {
        const sx = cx + side * eyeW * (0.76 + i * 0.07);
        const sy = baseY - eyeH * 0.08 * scale + i * eyeH * 0.07 * scale;
        const len = eyeW * (0.5 - i * 0.07) * scale;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(
          sx + side * len * 0.35,
          sy - eyeH * 0.3 * scale,
          sx + side * len * 0.55,
          sy - eyeH * 0.55 * scale,
        );
        ctx.stroke();
      }
      ctx.restore();
    };

    const gloss = (cx, cy, w) => {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.68)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, w, w * 0.38, -0.25, 0, Math.PI * 2);
      ctx.fill();
    };

    const pout = (cx, cy, w) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - w, cy);
      ctx.bezierCurveTo(cx - w * 0.56, cy - w * 0.24, cx - w * 0.2, cy - w * 0.3, cx, cy - w * 0.12);
      ctx.bezierCurveTo(cx + w * 0.2, cy - w * 0.3, cx + w * 0.56, cy - w * 0.24, cx + w, cy);
      ctx.bezierCurveTo(cx + w * 0.55, cy + w * 0.82, cx - w * 0.55, cy + w * 0.82, cx - w, cy);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 132, 184, 0.96)';
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1.2, width * 0.014);
      ctx.stroke();
      gloss(cx - w * 0.3, cy + w * 0.18, w * 0.2);
      ctx.restore();
    };

    const openSmile = (cx, cy, w) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - w, cy - w * 0.12);
      ctx.quadraticCurveTo(cx, cy + w * 1.08, cx + w, cy - w * 0.12);
      ctx.quadraticCurveTo(cx, cy + w * 0.2, cx - w, cy - w * 0.12);
      ctx.closePath();
      ctx.fillStyle = '#7a3458';
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1.3, width * 0.015);
      ctx.stroke();
      ctx.fillStyle = '#ff9cc9';
      ctx.beginPath();
      ctx.ellipse(cx, cy + w * 0.44, w * 0.28, w * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      gloss(cx - w * 0.4, cy + w * 0.04, w * 0.16);
      ctx.restore();
    };

    if (flustered) {
      // Spiral eyes read as flustered rather than a hard failure cross.
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap;
        ctx.beginPath();
        for (let i = 0; i <= 30; i += 1) {
          const t = i / 30;
          const angle = t * Math.PI * 3.4 + (side > 0 ? 0 : Math.PI);
          const radius = eyeW * t;
          const px = cx + Math.cos(angle) * radius;
          const py = eyeY + Math.sin(angle) * radius;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      });
    } else if (squished) {
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap;
        ctx.beginPath();
        ctx.moveTo(cx - eyeW * 1.05, eyeY - eyeW * 0.7);
        ctx.lineTo(cx + eyeW * 0.7, eyeY);
        ctx.lineTo(cx - eyeW * 1.05, eyeY + eyeW * 0.7);
        ctx.stroke();
      });
    } else if (offline) {
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.moveTo(x + side * eyeGap - eyeW, eyeY);
        ctx.lineTo(x + side * eyeGap + eyeW, eyeY);
        ctx.stroke();
      });
    } else if (sleepy) {
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap;
        ctx.beginPath();
        ctx.moveTo(cx - eyeW, eyeY);
        ctx.quadraticCurveTo(cx, eyeY + eyeW * 0.8, cx + eyeW, eyeY);
        ctx.stroke();
        lashFlicks(cx, eyeY, side);
      });
    } else if (waitingPose) {
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap;
        ctx.beginPath();
        ctx.ellipse(cx, eyeY + eyeH * 0.18, eyeW, eyeH * 0.58, 0, 0, Math.PI);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - eyeW, eyeY);
        ctx.lineTo(cx + eyeW, eyeY);
        ctx.stroke();
      });
    } else if (helloAge >= 0 && helloAge < 180) {
      // A quick surprised sparkle before the hearts arrive.
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap + gazeX * 0.35;
        ctx.beginPath();
        ctx.ellipse(cx, eyeY + gazeY * 0.35, eyeW * 1.06, eyeH * 1.04, 0, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = white;
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap + gazeX * 0.35;
        ctx.beginPath();
        ctx.arc(cx - eyeW * 0.26, eyeY - eyeH * 0.34, Math.max(1.6, eyeW * 0.22), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = ink;
    } else if (helloAge >= 180 && helloAge < 760) {
      // Heart eyes for the affection beat, then the usual ^^ settle.
      [-1, 1].forEach((side) => {
        drawHeart(ctx, x + side * eyeGap, eyeY + eyeH * 0.02, eyeW * 1.18, 0.96, pink);
      });
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.arc(x + side * eyeGap - eyeW * 0.32, eyeY - eyeH * 0.24, Math.max(1.4, eyeW * 0.16), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = ink;
    } else if (happy) {
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap;
        ctx.beginPath();
        ctx.arc(cx, eyeY + eyeW * 0.4, eyeW, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
        lashFlicks(cx, eyeY - eyeW * 0.25, side, 0.65);
      });
    } else if (blink) {
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap;
        ctx.beginPath();
        ctx.moveTo(cx - eyeW, eyeY);
        ctx.quadraticCurveTo(cx, eyeY + eyeW * 0.65, cx + eyeW, eyeY);
        ctx.stroke();
        lashFlicks(cx, eyeY, side);
      });
    } else {
      const wide = attention;
      ctx.save();
      ctx.fillStyle = ink;
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap + gazeX;
        ctx.beginPath();
        ctx.ellipse(
          cx,
          eyeY + gazeY,
          eyeW * (wide ? 1 : 0.92),
          eyeH * (wide ? 1.04 : 0.99),
          0,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      });

      ctx.strokeStyle = pupil;
      ctx.lineWidth = Math.max(1.3, width * 0.012);
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap + gazeX;
        ctx.beginPath();
        ctx.ellipse(cx, eyeY + gazeY, eyeW * 0.9, eyeH * 0.96, 0, Math.PI * 1.02, Math.PI * 1.98);
        ctx.stroke();
        const ox = cx + side * eyeW * 0.8;
        const oy = eyeY + gazeY - eyeH * 0.42;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.quadraticCurveTo(
          cx + side * eyeW * 1.18,
          eyeY + gazeY - eyeH * 0.64,
          cx + side * eyeW * 1.58,
          eyeY + gazeY - eyeH * 0.98,
        );
        ctx.stroke();
      });

      ctx.fillStyle = pupil;
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap + gazeX;
        ctx.beginPath();
        ctx.ellipse(cx + eyeW * 0.06, eyeY + gazeY + eyeH * 0.07, eyeW * 0.54, eyeH * 0.66, 0, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = white;
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap + gazeX;
        ctx.beginPath();
        ctx.arc(cx - eyeW * 0.24, eyeY + gazeY - eyeH * 0.22, Math.max(1.5, eyeW * 0.2), 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx + eyeW * 0.18, eyeY + gazeY + eyeH * 0.16, Math.max(1, eyeW * 0.08), 0, Math.PI * 2);
        ctx.fill();
      });

      [-1, 1].forEach((side) => {
        drawHeart(ctx, x + side * eyeGap + gazeX + eyeW * 0.18, eyeY + gazeY + eyeH * 0.36, eyeW * 0.3, 0.95, pink);
      });

      ctx.strokeStyle = 'rgba(255, 156, 204, 0.55)';
      ctx.lineWidth = Math.max(1, width * 0.008);
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap + gazeX;
        ctx.beginPath();
        ctx.ellipse(cx, eyeY + gazeY, eyeW * 0.82, eyeH * 0.88, 0, Math.PI * 0.18, Math.PI * 0.82);
        ctx.stroke();
      });

      [-1, 1].forEach((side) => {
        lashFlicks(x + side * eyeGap + gazeX, eyeY + gazeY - eyeH * 0.9, side, 0.85);
      });
      ctx.restore();
    }

    if (state !== 'error' && state !== 'offline') {
      ctx.strokeStyle = 'rgba(255, 156, 204, 0.82)';
      ctx.lineWidth = Math.max(1.2, width * 0.012);
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap;
        ctx.beginPath();
        ctx.moveTo(cx - eyeW * 1.15, eyeY - eyeH * 1.02);
        ctx.quadraticCurveTo(cx, eyeY - eyeH * 1.42, cx + eyeW * 1.18, eyeY - eyeH * 0.92);
        ctx.stroke();
      });
    }

    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = Math.max(2, width * 0.026);
    if (flustered) {
      // A wobbly mouth plus the spiral eyes sells "flustered" at a glance.
      ctx.beginPath();
      ctx.moveTo(x - eyeW * 1.05, mouthY);
      ctx.quadraticCurveTo(x - eyeW * 0.5, mouthY - eyeW * 0.5, x, mouthY);
      ctx.quadraticCurveTo(x + eyeW * 0.5, mouthY + eyeW * 0.5, x + eyeW * 1.05, mouthY);
      ctx.stroke();
    } else if (squished) {
      pout(x, mouthY, eyeW * 0.3);
    } else if (waitingPose) {
      ctx.beginPath();
      ctx.moveTo(x - eyeW * 0.55, mouthY);
      ctx.lineTo(x + eyeW * 0.55, mouthY);
      ctx.stroke();
    } else if (tappingPose) {
      ctx.beginPath();
      ctx.ellipse(x, mouthY, eyeW * 0.28, eyeW * (0.34 + Math.sin(now / 220) * 0.05), 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 132, 184, 0.96)';
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1.3, width * 0.014);
      ctx.stroke();
    } else if (offline) {
      ctx.beginPath();
      ctx.moveTo(x - eyeW, mouthY);
      ctx.quadraticCurveTo(x, mouthY + eyeW * 0.35, x + eyeW, mouthY);
      ctx.stroke();
    } else if (attention) {
      ctx.fillStyle = 'rgba(255, 132, 184, 0.96)';
      ctx.beginPath();
      ctx.ellipse(x, mouthY, eyeW * 0.42, eyeW * 0.54, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1.3, width * 0.014);
      ctx.stroke();
      gloss(x - eyeW * 0.12, mouthY - eyeW * 0.12, eyeW * 0.1);
    } else if (helloAge >= 0 && helloAge < 180) {
      ctx.fillStyle = 'rgba(255, 132, 184, 0.96)';
      ctx.beginPath();
      ctx.ellipse(x, mouthY, eyeW * 0.26, eyeW * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1.3, width * 0.014);
      ctx.stroke();
      gloss(x - eyeW * 0.08, mouthY - eyeW * 0.1, eyeW * 0.07);
    } else if (happy) {
      openSmile(x, mouthY, eyeW * 0.95);
    } else if (state === 'thinking') {
      pout(x, mouthY, eyeW * 0.58);
    } else if (state === 'working') {
      pout(x, mouthY, eyeW * 0.7);
    } else {
      pout(x, mouthY, eyeW * 0.62);
    }

    // soft screen blush with a little shimmer
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    [-1, 1].forEach((side) => {
      const bx = x + side * (eyeGap + eyeW * 1.2);
      const by = mouthY - eyeH * 0.3;
      const radius = eyeW * 1.4;
      const gradient = ctx.createRadialGradient(bx, by, 1, bx, by, radius);
      const blushStrength = helloAge >= 0 ? 1.28 : 1;
      gradient.addColorStop(0, `rgba(255, 150, 195, ${0.62 * blushStrength})`);
      gradient.addColorStop(0.5, `rgba(255, 150, 190, ${0.26 * blushStrength})`);
      gradient.addColorStop(1, 'rgba(255, 150, 190, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(bx, by, radius, radius * 0.68, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    if (state === 'working') {
      ctx.fillStyle = 'rgba(255, 199, 221, 0.5)';
      const fontSize = Math.max(6, width * 0.055);
      ctx.font = `600 ${fontSize}px "Segoe UI", system-ui, monospace`;
      ctx.textAlign = 'left';
      ctx.fillText('>_', x - width * 0.38, y + height * 0.42);
    }
    ctx.restore();
  }

  function drawThought(ctx, { x, y, state, thoughtBubbles, hobby }) {
    if (thoughtBubbles === 'off') return;
    if (state === 'needs-you' || state === 'error' || state === 'offline') return;
    let label = null;
    if (state === 'thinking') label = 'thinking';
    else if (state === 'working') label = 'working';
    else if (state === 'done') label = 'done';
    else if (state === 'sleepy') label = 'sleepy';
    else if (hobby) label = hobby.id;
    if (!label) return;
    const words = thoughtBubbles === 'words';
    const text = words ? label : state === 'thinking' ? '💭' : state === 'working' ? '⌨' : state === 'done' ? '✨' : '☾';
    ctx.save();
    ctx.font = words ? '600 11px "Segoe UI", system-ui, sans-serif' : '15px "Segoe UI Emoji", "Segoe UI", sans-serif';
    const width = Math.max(28, ctx.measureText(text).width + 18);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(44, 27, 41, 0.9)';
    ctx.strokeStyle = 'rgba(255, 186, 214, 0.35)';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, width, 24, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff4ea';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + width / 2, y + 12.5);
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 24);
    ctx.lineTo(x + 6, y + 31);
    ctx.lineTo(x + 16, y + 24);
    ctx.fillStyle = 'rgba(44, 27, 41, 0.9)';
    ctx.fill();
    ctx.restore();
  }

  function drawStateEffects(ctx, { x, y, width, height, state, pose = null, now, reducedMotion, pending, celebration = false }) {
    const cx = x + width / 2;
    const cy = y + height * 0.34;
    if (state === 'needs-you' || pending > 0) {
      const pulse = reducedMotion ? 0.6 : 0.45 + 0.25 * Math.sin(now / 420);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 126, 178, ${pulse})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, width * 0.48, height * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (pending > 0) {
        const label = String(pending);
        const bx = x + width * 0.78;
        const by = y + height * 0.14;
        ctx.fillStyle = '#e5447f';
        ctx.beginPath();
        ctx.arc(bx, by, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffe4ef';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '800 14px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx, by + 0.5);
      }
      ctx.restore();
    }
    if (state === 'error') {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#6b4a66';
      roundRect(ctx, cx - 20, y + height * 0.05, 40, 18, 9);
      ctx.fill();
      ctx.strokeStyle = '#9fd0e0';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i += 1) {
        const rx = cx - 12 + i * 12;
        ctx.beginPath();
        ctx.moveTo(rx, y + height * 0.11);
        ctx.lineTo(rx - 4, y + height * 0.17);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (state === 'done') {
      const colors = ['#ffd77a', '#ffa3c6', '#b9d7ff'];
      for (let i = 0; i < 5; i += 1) {
        const angle = (Math.PI * 2 * i) / 5 + now / 900;
        const radius = width * 0.45;
        drawSparkle(
          ctx,
          cx + Math.cos(angle) * radius,
          cy + Math.sin(angle) * radius * 0.6,
          width * 0.018,
          colors[i % colors.length],
          0.55 + 0.35 * Math.sin(now / 260 + i),
        );
      }
    }
    if (pose === 'flustered') {
      ctx.save();
      const drop = reducedMotion ? 0.4 : 0.5 + 0.5 * Math.sin(now / 520);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#9fd0e0';
      ctx.strokeStyle = '#5c3150';
      ctx.lineWidth = 1.6;
      const dx = x + width * 0.72;
      const dy = y + height * 0.2;
      ctx.beginPath();
      ctx.moveTo(dx, dy - 9 - drop * 3);
      ctx.bezierCurveTo(dx - 7, dy - 1, dx - 7, dy + 6, dx, dy + 7);
      ctx.bezierCurveTo(dx + 7, dy + 6, dx + 7, dy - 1, dx, dy - 9 - drop * 3);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(231, 139, 176, 0.8)';
      ctx.lineWidth = 2;
      [-1, 1].forEach((side) => {
        for (let i = 0; i < 2; i += 1) {
          const sx = cx + side * width * (0.34 + i * 0.04);
          const sy = cy - height * (0.13 + i * 0.04);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + side * width * 0.035, sy - height * 0.02);
          ctx.stroke();
        }
      });
      ctx.restore();
    }

    if (pose === 'tapping') {
      ctx.save();
      const rx = cx + width * 0.27;
      const ry = cy + height * 0.01;
      // Ripples on the glass, one wave per tap.
      for (let i = 0; i < 3; i += 1) {
        const phase = reducedMotion ? i / 3 : ((now / 900 + i / 3) % 1);
        ctx.globalAlpha = (1 - phase) * 0.7;
        ctx.strokeStyle = '#ffd77a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(rx, ry, width * (0.03 + phase * 0.09), -0.8, 0.8);
        ctx.stroke();
      }
      // A little hand tapping at the screen from inside.
      const tapOffset = reducedMotion ? 0 : Math.max(0, Math.sin(now / 130)) * 4;
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = '#fbe6d9';
      ctx.strokeStyle = '#5c3150';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(rx + 13 + tapOffset, ry + 12, width * 0.055, width * 0.042, -0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(rx - 2 + tapOffset, ry + 5, width * 0.018, width * 0.03, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    if (pose === 'squish') {
      ctx.save();
      const squeeze = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(now / 220);
      ctx.globalAlpha = 0.5 + squeeze * 0.3;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.strokeStyle = 'rgba(255, 199, 221, 0.75)';
      ctx.lineWidth = 2;
      [-1, 1].forEach((side) => {
        const px = cx + side * width * (0.36 + squeeze * 0.03);
        ctx.beginPath();
        ctx.arc(px, cy + height * 0.16, width * (0.022 + squeeze * 0.012), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px + side * width * 0.04, cy + height * 0.02);
        ctx.lineTo(px + side * width * 0.08, cy + height * 0.06);
        ctx.stroke();
      });
      ctx.restore();
    }

    if (pose === 'waiting') {
      ctx.save();
      const r = Math.max(11, width * 0.06);
      const bx = x + width * 0.74;
      const by = y + height * 0.1;
      ctx.fillStyle = 'rgba(44, 27, 41, 0.9)';
      ctx.strokeStyle = 'rgba(255, 186, 214, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#ffe9f3';
      ctx.lineWidth = 2;
      const angle = reducedMotion ? Math.PI * 0.25 : (now / 2600) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.sin(angle) * r * 0.52, by - Math.cos(angle) * r * 0.52);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(now / 9000) * r * 0.34, by + Math.sin(now / 9000) * r * 0.34);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 233, 243, 0.8)';
      for (let i = 0; i < 3; i += 1) {
        const pulse = reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(now / 480 + i * 0.8);
        ctx.globalAlpha = pulse;
        ctx.beginPath();
        ctx.arc(bx - 10 + i * 10, by + r + 10, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (celebration || pose === 'celebrate') {
      ctx.save();
      const colors = ['#ffd77a', '#ff9fc6', '#b9d7ff', '#b8e8c8', '#d5b8ff'];
      const pieces = reducedMotion ? 6 : 14;
      for (let i = 0; i < pieces; i += 1) {
        const spread = Math.sin(i * 2.399) * width * 0.44;
        const fall = reducedMotion ? (i % 6) / 8 : ((now / 1100 + i * 0.137) % 1);
        const px = cx + spread;
        const py = y + height * 0.04 + fall * height * 0.74;
        ctx.globalAlpha = 0.9 - fall * 0.4;
        ctx.fillStyle = colors[i % colors.length];
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(fall * 7 + i);
        ctx.fillRect(-2.2, -4.5, 4.4, 9);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      drawSparkle(ctx, cx + width * 0.38, cy - height * 0.16, width * 0.024, '#ffd77a', 0.9);
      drawSparkle(ctx, cx - width * 0.4, cy - height * 0.2, width * 0.02, '#ff9fc6', 0.8);
      ctx.restore();
    }

    if (state === 'wave') {
      drawHeart(ctx, cx + width * 0.42, cy - height * 0.05, width * 0.022, 0.7, '#ff9fc6');
    }
  }

  function draw(ctx, options) {
    const {
      characterId,
      look = {},
      clothing = {},
      state = 'idle',
      category = 'thinking',
      hobby = null,
      now = 0,
      width = 380,
      height = 520,
      baseY = null,
      compact = false,
      cursor = null,
      reducedMotion = false,
      thoughtBubbles = 'off',
      greeting = false,
      pending = 0,
      waiting = false,
      celebration = false,
      stateSince = 0,
      customImage = null,
      poseOverride = null,
    } = options;
    const character = getCharacter(characterId);
    const ready = entry(character.id);

    if (customImage && customImage.naturalWidth) {
      const aspect = customImage.naturalWidth / customImage.naturalHeight;
      const drawHeight = Math.min(compact ? height * 0.98 : height * 0.96, width / aspect);
      const drawWidth = drawHeight * aspect;
      const originX = (width - drawWidth) / 2;
      const originY = (baseY ?? height) - drawHeight;
      const bob = reducedMotion ? 0 : Math.sin(now / 1000) * 2.2;
      ctx.save();
      const shadowWidth = drawWidth * 0.34;
      const shadowY = (baseY ?? height) - drawHeight * 0.015;
      const shadow = ctx.createRadialGradient(originX + drawWidth / 2, shadowY, 2, originX + drawWidth / 2, shadowY, shadowWidth);
      shadow.addColorStop(0, 'rgba(44, 24, 40, 0.26)');
      shadow.addColorStop(1, 'rgba(44, 24, 40, 0)');
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.ellipse(originX + drawWidth / 2, shadowY, shadowWidth, drawHeight * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(customImage, originX, originY + bob, drawWidth, drawHeight);
      drawStateEffects(ctx, {
        x: originX,
        y: originY + bob,
        width: drawWidth,
        height: drawHeight,
        state,
        now,
        reducedMotion,
        pending,
        celebration,
      });
      ctx.restore();
      return;
    }

    const hasArt = character.renderer === 'atlas' ? Boolean(imageFor(character.id, character.atlas)) : Boolean(imageFor(character.id, character.base));
    if (!hasArt) {
      if (!ready.loading) preload(character.id);
      if (ready.failed.size) drawLegacy(ctx, options);
      else drawPlaceholder(ctx, options);
      return;
    }

    const theme = themeOf(look.theme);
    const style = character.renderer === 'atlas' ? 'atlas' : 'layered';
    const atlasCell = character.cell || { width: 256, height: 320 };
    const atlasCompactCell = character.compactCell || {
      x: 0,
      y: 0,
      width: atlasCell.width,
      height: atlasCell.height * 0.7,
    };
    const source = style === 'atlas'
      ? compact
        ? atlasCompactCell
        : { x: 0, y: 0, width: atlasCell.width, height: atlasCell.height }
      : compact && character.compactCrop
        ? character.compactCrop
        : { x: 0, y: 0, width: character.size?.width || 512, height: character.size?.height || 640 };
    const aspect = source.width / source.height;
    const targetHeight = compact ? height * 0.98 : height * 0.96;
    const drawHeight = Math.min(targetHeight, width / aspect);
    const drawWidth = drawHeight * aspect;
    const originX = (width - drawWidth) / 2;
    const originY = (baseY ?? height) - drawHeight;

    const resolvedPose = poseFor({ state, category, hobby, greeting, waiting, celebration });
    // The reaction itself outlives the body cell: an atlas companion borrows
    // its nearest drawn mood, but motion, effects, and the face still use the
    // reaction, so an error or a waiting turn reads the same on every friend.
    const reactionPose = poseOverride || resolvedPose;
    const pose = style === 'atlas'
      ? atlasPose(reactionPose)
      : poseOverride
        ? poseOverride
        : state === 'working' && !waiting && !celebration && category !== 'compacting'
          ? typingPose(now, category)
          : resolvedPose;

    const bobAmplitude = reducedMotion ? 0 : state === 'sleepy' ? 1 : 2.4;
    const bob = Math.sin(now / 1000) * bobAmplitude + (reducedMotion ? 0 : Math.sin(now / 2600) * 0.8);
    const breathe = reducedMotion ? 1 : 1 + Math.sin(now / 1500) * 0.005;
    const attention = state === 'needs-you';
    const shake = state === 'error' && !reducedMotion ? Math.sin(now / 42) * 2.1 : 0;
    const hop = state === 'done' && !reducedMotion ? -Math.abs(Math.sin(now / 190)) * 5 : 0;
    const waveTilt = state === 'wave' && !reducedMotion ? Math.sin(now / 120) * 0.025 : 0;
    const pulse = attention && !reducedMotion ? 1 + Math.sin(now / 380) * 0.008 : 1;
    const squish = reactionPose === 'squish' && !reducedMotion ? 0.9 + Math.sin(now / 180) * 0.018 : 1;
    const tap = reactionPose === 'tapping' && !reducedMotion ? Math.sin(now / 95) * 1.8 : 0;
    const cheerHop = reactionPose === 'celebrate' && !reducedMotion ? -Math.abs(Math.sin(now / 170)) * 7 : 0;
    const helloAge = state === 'hello' ? Math.max(0, now - stateSince) : -1;
    const helloWiggle = helloAge >= 0 && !reducedMotion
      ? Math.sin(helloAge / 48) * 0.022 * Math.max(0, 1 - helloAge / 1200)
      : 0;
    const helloSquash = helloAge >= 0 && !reducedMotion
      ? Math.sin(Math.min(helloAge, 720) / 62) * Math.exp(-Math.min(helloAge, 720) / 320)
      : 0;
    const curiousTilt = !reducedMotion && (state === 'needs-you' || reactionPose === 'waiting')
      ? Math.sin(now / 1200) * 0.012
      : 0;

    // Ground shadow stays put while the character floats.
    ctx.save();
    const shadowWidth = drawWidth * (compact ? 0.26 : 0.36);
    const shadowY = (baseY ?? height) - drawHeight * 0.015;
    const shadow = ctx.createRadialGradient(originX + drawWidth / 2, shadowY, 2, originX + drawWidth / 2, shadowY, shadowWidth);
    shadow.addColorStop(0, 'rgba(44, 24, 40, 0.26)');
    shadow.addColorStop(1, 'rgba(44, 24, 40, 0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(originX + drawWidth / 2, shadowY, shadowWidth, drawHeight * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(originX + drawWidth / 2 + shake + tap, originY + drawHeight / 2 + bob + hop + cheerHop);
    ctx.rotate(waveTilt + helloWiggle + curiousTilt);
    ctx.scale(
      (1 + (breathe - 1) * 0.5) * pulse * (2 - squish) * (1 + helloSquash * 0.05),
      (1 - (breathe - 1) * 0.5) * squish * (1 - helloSquash * 0.04),
    );
    ctx.translate(-drawWidth / 2, -drawHeight / 2);

    const drawImage = (image, rel, { filter = null, alpha = 1, rotate = 0, scale = 1, pivot = null } = {}) => {
      if (!image) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (filter) ctx.filter = filter;
      if (pivot) {
        const px = ((pivot.x - source.x) / source.width) * drawWidth;
        const py = ((pivot.y - source.y) / source.height) * drawHeight;
        ctx.translate(px, py);
        if (rotate) ctx.rotate(rotate);
        if (scale !== 1) ctx.scale(scale, scale);
        ctx.translate(-px, -py);
      }
      ctx.drawImage(
        image,
        style === 'atlas' ? 0 : source.x,
        style === 'atlas' ? 0 : source.y,
        style === 'atlas' ? source.width : source.width,
        style === 'atlas' ? source.height : source.height,
        0,
        0,
        drawWidth,
        drawHeight,
      );
      ctx.restore();
    };

    if (style === 'atlas') {
      const atlas = imageFor(character.id, character.atlas);
      const cellW = atlasCell.width;
      const cellH = atlasCell.height;
      const index = Math.max(0, (character.order || []).indexOf(pose));
      const columns = character.columns || 3;
      const sx = (index % columns) * cellW;
      const sy = Math.floor(index / columns) * cellH;
      ctx.save();
      if (compact) {
        const crop = atlasCompactCell;
        ctx.drawImage(atlas, sx + crop.x, sy + crop.y, crop.width, crop.height, 0, 0, drawWidth, drawHeight);
      } else {
        ctx.drawImage(atlas, sx, sy, cellW, cellH, 0, 0, drawWidth, drawHeight);
      }
      ctx.restore();
      if (!compact && clothing.outfit !== false && look.outfit && look.outfit !== 'none') {
        const outfitRel = character.outfitAssets?.[look.outfit];
        drawImage(imageFor(character.id, outfitRel), outfitRel);
      }
      if (!compact) {
        const drawAccessory = (slot) => {
          if (clothing[slot] === false) return;
          const value = look[slot];
          if (!value || value === 'none') return;
          const rel = character.accessoryAssets?.[slot]?.[value];
          drawImage(imageFor(character.id, rel), rel);
        };
        drawAccessory('glasses');
        drawAccessory('hat');
        drawAccessory('bow');
        if (pose === 'idle' && !hobby) drawAccessory('wand');
        drawStateEffects(ctx, {
          x: 0,
          y: 0,
          width: drawWidth,
          height: drawHeight,
          state,
          pose: reactionPose,
          now,
          reducedMotion,
          pending,
          celebration,
        });
      }
    } else {
      drawImage(imageFor(character.id, character.base), character.base);
      if (clothing.outfit !== false && look.outfit && look.outfit !== 'none') {
        const outfitRel = character.outfitAssets?.[look.outfit];
        drawImage(imageFor(character.id, outfitRel), outfitRel, { filter: theme.filter });
      }
      if (!compact) {
        const poseRel = character.poses?.[pose];
        drawImage(imageFor(character.id, poseRel), poseRel);
      }

      if (character.face) {
        const face = character.face;
        // The manifest stores the face center (the screen's optical center),
        // not its top-left corner. This keeps the expression inside the screen.
        const faceCenterX = ((face.x - source.x) / source.width) * drawWidth;
        const faceCenterY = ((face.y - source.y) / source.height) * drawHeight;
        const faceW = (face.width / source.width) * drawWidth;
        const faceH = (face.height / source.height) * drawHeight;
        let gazeX = 0;
        let gazeY = 0;
        if (cursor) {
          const dx = cursor.x - (originX + faceCenterX);
          const dy = cursor.y - (originY + faceCenterY);
          const distance = Math.hypot(dx, dy) || 1;
          const reach = Math.min(1, distance / 120);
          gazeX = (dx / distance) * Math.min(2.6, faceW * 0.02) * reach;
          gazeY = (dy / distance) * Math.min(2, faceH * 0.03) * reach;
        }
        if (reactionPose === 'tapping' && !reducedMotion) gazeX = Math.sin(now / 240) * 1.6;
        const blink = !reducedMotion && !['needs-you', 'error', 'sleepy', 'done', 'hello', 'wave', 'offline'].includes(state) && now % 4300 < 115;
        drawFace(ctx, {
          x: faceCenterX,
          y: faceCenterY,
          width: faceW,
          height: faceH,
          state,
          pose: reactionPose,
          blink,
          gazeX,
          gazeY,
          hobby,
          reducedMotion,
          now,
          stateSince,
        });
      }

      if (!compact) {
        if (clothing.glasses !== false && look.glasses && look.glasses !== 'none') {
          const glassesRel = character.accessoryAssets?.glasses?.[look.glasses];
          drawImage(imageFor(character.id, glassesRel), glassesRel);
        }
        if (clothing.hat !== false && look.hat && look.hat !== 'none') {
          const hatRel = character.accessoryAssets?.hat?.[look.hat];
          drawImage(imageFor(character.id, hatRel), hatRel);
        }
        if (clothing.bow !== false && look.bow && look.bow !== 'none') {
          const bowRel = character.accessoryAssets?.bow?.[look.bow];
          const bowSwing = reducedMotion ? 0 : Math.sin(now / 1000 - 0.7) * 0.022 + helloWiggle * 1.2;
          drawImage(imageFor(character.id, bowRel), bowRel, {
            rotate: bowSwing,
            scale: 1.12,
            pivot: { x: 366, y: 190 },
          });
        }
        if (
          clothing.wand !== false &&
          look.wand &&
          look.wand !== 'none' &&
          pose === 'idle' &&
          !hobby
        ) {
          const wandRel = character.accessoryAssets?.wand?.[look.wand];
          drawImage(imageFor(character.id, wandRel), wandRel);
        }
      }

      drawStateEffects(ctx, {
        x: 0,
        y: 0,
        width: drawWidth,
        height: drawHeight,
        state: compact ? 'idle' : state,
        pose: compact ? null : pose,
        now,
        reducedMotion,
        pending,
        celebration: compact ? false : celebration,
      });

      if (!compact) {
        drawThought(ctx, {
          x: drawWidth * 0.72,
          y: drawHeight * 0.015,
          state,
          thoughtBubbles,
          hobby,
        });
      }
    }

    ctx.restore();
  }

  globalThis.BuffyCharacters = {
    manifest,
    getCharacter,
    preload,
    isReady,
    missingAssets,
    availableChecker,
    themeAccent,
    poseFor,
    atlasPose,
    draw,
    drawSparkle,
    drawHeart,
    roundRect,
  };
})();
