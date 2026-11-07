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
      for (const file of Object.values(character.outfitAssets || {})) list.push(file);
      for (const slot of Object.values(character.accessoryAssets || {})) {
        for (const file of Object.values(slot || {})) list.push(file);
      }
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

  function poseFor({ state = 'idle', category = 'thinking', hobby = null, greeting = false } = {}) {
    if (greeting) return 'wave';
    if (state === 'done' || state === 'pet') return 'happy';
    if (state === 'working') {
      if (category === 'reading' || category === 'searching') return 'reading';
      if (category === 'compacting') return 'typingLeft';
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

  function drawFace(ctx, { x, y, width, height, state, blink, gazeX, gazeY, hobby, reducedMotion }) {
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

    const happy = state === 'done' || state === 'pet' || state === 'wave' || hobby;
    const sleepy = state === 'sleepy';
    const error = state === 'error';
    const offline = state === 'offline';
    const attention = state === 'needs-you';

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

    if (error) {
      [-1, 1].forEach((side) => {
        const cx = x + side * eyeGap;
        ctx.beginPath();
        ctx.moveTo(cx - eyeW, eyeY - eyeW);
        ctx.lineTo(cx + eyeW, eyeY + eyeW);
        ctx.moveTo(cx + eyeW, eyeY - eyeW);
        ctx.lineTo(cx - eyeW, eyeY + eyeW);
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
    if (error) {
      ctx.beginPath();
      ctx.moveTo(x - eyeW, mouthY);
      ctx.quadraticCurveTo(x, mouthY - eyeW * 0.7, x + eyeW, mouthY);
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
      gradient.addColorStop(0, 'rgba(255, 150, 195, 0.62)');
      gradient.addColorStop(0.5, 'rgba(255, 150, 190, 0.26)');
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

  function drawStateEffects(ctx, { x, y, width, height, state, now, reducedMotion, pending }) {
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
    const source = style === 'atlas'
      ? {
          x: 0,
          y: 0,
          width: character.cell?.width || 256,
          height: character.cell?.height || 320,
        }
      : compact && character.compactCrop
        ? character.compactCrop
        : { x: 0, y: 0, width: character.size?.width || 512, height: character.size?.height || 640 };
    const aspect = source.width / source.height;
    const targetHeight = compact ? height * 0.98 : height * 0.96;
    const drawHeight = Math.min(targetHeight, width / aspect);
    const drawWidth = drawHeight * aspect;
    const originX = (width - drawWidth) / 2;
    const originY = (baseY ?? height) - drawHeight;

    const pose =
      poseOverride ||
      (style === 'atlas'
        ? poseFor({ state, category, hobby, greeting })
        : state === 'working'
          ? typingPose(now, category)
          : poseFor({ state, category, hobby, greeting }));

    const bobAmplitude = reducedMotion ? 0 : state === 'sleepy' ? 1 : 2.4;
    const bob = Math.sin(now / 1000) * bobAmplitude + (reducedMotion ? 0 : Math.sin(now / 2600) * 0.8);
    const breathe = reducedMotion ? 1 : 1 + Math.sin(now / 1500) * 0.005;
    const attention = state === 'needs-you';
    const shake = state === 'error' && !reducedMotion ? Math.sin(now / 42) * 2.1 : 0;
    const hop = state === 'done' && !reducedMotion ? -Math.abs(Math.sin(now / 190)) * 5 : 0;
    const waveTilt = state === 'wave' && !reducedMotion ? Math.sin(now / 120) * 0.025 : 0;
    const pulse = attention && !reducedMotion ? 1 + Math.sin(now / 380) * 0.008 : 1;

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
    ctx.translate(originX + drawWidth / 2 + shake, originY + drawHeight / 2 + bob + hop);
    ctx.rotate(waveTilt);
    ctx.scale((1 + (breathe - 1) * 0.5) * pulse, 1 - (breathe - 1) * 0.5);
    ctx.translate(-drawWidth / 2, -drawHeight / 2);

    const drawImage = (image, rel, { filter = null, alpha = 1 } = {}) => {
      if (!image) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (filter) ctx.filter = filter;
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
      const cellW = character.cell.width;
      const cellH = character.cell.height;
      const index = Math.max(0, (character.order || []).indexOf(pose));
      const columns = character.columns || 3;
      const sx = (index % columns) * cellW;
      const sy = Math.floor(index / columns) * cellH;
      ctx.save();
      if (compact) {
        const crop = character.compactCell || { x: 0, y: 0, width: cellW, height: cellH * 0.7 };
        ctx.drawImage(atlas, sx + crop.x, sy + crop.y, crop.width, crop.height, 0, 0, drawWidth, drawHeight);
      } else {
        ctx.drawImage(atlas, sx, sy, cellW, cellH, 0, 0, drawWidth, drawHeight);
      }
      ctx.restore();
      if (!compact && clothing.bow !== false && look.bow && look.bow !== 'none') {
        const bowRel = character.accessoryAssets?.bow?.[look.bow];
        drawImage(imageFor(character.id, bowRel), bowRel);
      }
      if (!compact) {
        drawStateEffects(ctx, {
          x: 0,
          y: 0,
          width: drawWidth,
          height: drawHeight,
          state,
          now,
          reducedMotion,
          pending,
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
        const blink = !reducedMotion && !['needs-you', 'error', 'sleepy', 'done', 'pet', 'wave', 'offline'].includes(state) && now % 4300 < 115;
        drawFace(ctx, {
          x: faceCenterX,
          y: faceCenterY,
          width: faceW,
          height: faceH,
          state,
          blink,
          gazeX,
          gazeY,
          hobby,
          reducedMotion,
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
          drawImage(imageFor(character.id, bowRel), bowRel);
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
        now,
        reducedMotion,
        pending,
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
    draw,
    drawSparkle,
    drawHeart,
    roundRect,
  };
})();
