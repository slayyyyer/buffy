/* global window, document, performance, requestAnimationFrame */
(function main() {
  'use strict';

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const bubbleEl = document.getElementById('bubble');
  const textEl = document.getElementById('text');
  const sourceEl = document.getElementById('source');
  const PET_SCALE = 1.35;

  const DEFAULT_MESSAGES = {
    'needs-you': 'I need you for something.',
    done: 'Done! Nice one.',
    error: 'Something broke.',
    thinking: 'Thinking…',
    working: 'Working…',
  };

  let snapshot = null;
  let offline = false;
  let lastKey = '';
  let reactAt = 0;
  let bubbleUntil = 0;
  let customImage = null;
  let customImageKey = '';

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

  function currentPalette() {
    const sprite = snapshot && snapshot.pet && snapshot.pet.sprite;
    const seed = (sprite && sprite.seed) || (snapshot && snapshot.pet && snapshot.pet.seed) || 7;
    return (sprite && sprite.palette) || paletteFromSeed(seed);
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
  }

  window.addEventListener('resize', resize);
  resize();

  function showBubble(text, source, state, durationMs) {
    if (!text) return;
    textEl.textContent = text;
    sourceEl.textContent = source ? String(source).slice(0, 18) : '';
    bubbleEl.classList.remove('hidden');
    const sticky = state === 'needs-you' || state === 'error';
    bubbleUntil = sticky ? Infinity : performance.now() + (durationMs || 6500);
  }

  function hideBubble() {
    bubbleEl.classList.add('hidden');
    bubbleUntil = 0;
  }

  function applySnapshot(next) {
    if (!next) return;
    offline = false;
    snapshot = next;
    syncSpriteImage(next.pet && next.pet.sprite, next.port);
    const current = next.current || {};
    const message = current.message || DEFAULT_MESSAGES[current.state] || null;
    const key = `${current.seq || 0}|${current.state || 'idle'}|${message || ''}`;
    if (key !== lastKey) {
      lastKey = key;
      if (message) showBubble(message, current.source, current.state);
      else hideBubble();
    }
  }

  window.buffy.onState((payload) => {
    if (!payload) {
      offline = true;
      return;
    }
    applySnapshot(payload);
  });

  function petIt() {
    reactAt = performance.now();
    showBubble('That tickles.', 'you', 'idle', 2200);
    window.buffy.pet();
  }

  window.buffy.onPetRequest(() => petIt());

  function stateAt(now) {
    if (offline) return 'offline';
    if (now - reactAt < 2200) return 'pet';
    return (snapshot && snapshot.current && snapshot.current.state) || 'idle';
  }

  function drawShadow(centerX, baseY, bob) {
    ctx.save();
    ctx.translate(centerX, baseY + 12 * PET_SCALE);
    ctx.scale(1 - bob / 260, 1);
    const radius = 50 * PET_SCALE;
    const gradient = ctx.createRadialGradient(0, 0, 4, 0, 0, radius);
    gradient.addColorStop(0, 'rgba(20, 16, 10, 0.30)');
    gradient.addColorStop(1, 'rgba(20, 16, 10, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(0, 0, radius, 12 * PET_SCALE, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function roundRect(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  function drawBackBits(variant, hue, hue2) {
    ctx.strokeStyle = `hsl(${hue} 45% 35%)`;
    ctx.fillStyle = `hsl(${hue2} 72% 64%)`;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    if (variant === 1) {
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.moveTo(side * 19, -38);
        ctx.quadraticCurveTo(side * 32, -60, side * 23, -66);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(side * 23, -66, 4.5, 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }

    if (variant === 2) {
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.moveTo(side * 25, -36);
        ctx.quadraticCurveTo(side * 36, -56, side * 24, -58);
        ctx.stroke();
      });
      return;
    }

    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * 30, -33);
      ctx.quadraticCurveTo(side * 46, -58, side * 15, -43);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  }

  function drawCrossEye(x, y, size) {
    ctx.beginPath();
    ctx.moveTo(x - size / 2, y - size / 2);
    ctx.lineTo(x + size / 2, y + size / 2);
    ctx.moveTo(x + size / 2, y - size / 2);
    ctx.lineTo(x - size / 2, y + size / 2);
    ctx.stroke();
  }

  function drawFace(now, state, hue) {
    const ink = `hsl(${hue} 45% 18%)`;
    const eyeY = -9;
    const blink = now % 4300 < 120 && !['needs-you', 'error', 'pet', 'done', 'offline'].includes(state);

    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    const happy = state === 'pet' || state === 'done';
    if (happy) {
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.arc(side * 19, eyeY + 2, 8, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      });
    } else if (state === 'error') {
      drawCrossEye(-19, eyeY, 9);
      drawCrossEye(19, eyeY, 9);
    } else if (state === 'offline') {
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.moveTo(side * 19 - 8, eyeY);
        ctx.quadraticCurveTo(side * 19, eyeY + 3, side * 19 + 8, eyeY);
        ctx.stroke();
      });
    } else if (blink) {
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.moveTo(side * 19 - 7, eyeY);
        ctx.quadraticCurveTo(side * 19, eyeY + 3, side * 19 + 7, eyeY);
        ctx.stroke();
      });
    } else {
      const wide = state === 'needs-you' ? 8.5 : 7;
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.ellipse(side * 19, eyeY, wide, wide * 1.05, 0, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.arc(side * 19 - 2.5, eyeY - 2, 2.1, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = ink;
    }

    const mouthY = 20;
    if (state === 'needs-you') {
      ctx.beginPath();
      ctx.ellipse(0, mouthY + 2, 6.5, 8.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (state === 'error') {
      ctx.beginPath();
      ctx.moveTo(-10, mouthY + 3);
      ctx.quadraticCurveTo(-5, mouthY - 2, 0, mouthY + 2);
      ctx.quadraticCurveTo(5, mouthY + 6, 10, mouthY + 1);
      ctx.stroke();
    } else if (state === 'thinking') {
      ctx.beginPath();
      ctx.moveTo(-5, mouthY + 1);
      ctx.lineTo(5, mouthY + 1);
      ctx.stroke();
    } else if (state === 'working') {
      ctx.beginPath();
      ctx.arc(0, mouthY - 4, 7, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
    } else if (state === 'pet') {
      ctx.beginPath();
      ctx.ellipse(0, mouthY, 7, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (state === 'offline') {
      ctx.beginPath();
      ctx.moveTo(-6, mouthY + 2);
      ctx.quadraticCurveTo(0, mouthY - 2, 6, mouthY + 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, mouthY - 4, 9, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
  }

  function drawKeyboard(now, hue) {
    ctx.save();
    ctx.translate(0, 41);
    ctx.fillStyle = `hsl(${hue} 22% 30%)`;
    roundRect(-35, -2, 70, 18, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    for (let i = 0; i < 4; i += 1) ctx.fillRect(-28 + i * 15, 4, 9, 3);
    const tap = Math.sin(now / 90) * 2;
    ctx.fillStyle = `hsl(${hue} 62% 74%)`;
    [-31, 31].forEach((x, index) => {
      ctx.beginPath();
      ctx.arc(x, -4 + (index === 0 ? tap : -tap), 7, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawSparkle(x, y, size, color, alpha) {
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

  function drawHeart(x, y, size, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ff7b93';
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.7);
    ctx.bezierCurveTo(x - size * 1.4, y - size * 0.35, x - size * 0.4, y - size, x, y - size * 0.35);
    ctx.bezierCurveTo(x + size * 0.4, y - size, x + size * 1.4, y - size * 0.35, x, y + size * 0.7);
    ctx.fill();
    ctx.restore();
  }

  function drawEffects(now, state, centerX, centerY) {
    if (state === 'thinking') {
      for (let i = 0; i < 3; i += 1) {
        const progress = ((now / 1100 + i / 3) % 1);
        const x = centerX + 54 + Math.sin(progress * Math.PI) * 7;
        const y = centerY - 38 - progress * 30;
        ctx.globalAlpha = 1 - progress;
        ctx.fillStyle = `hsl(${currentPalette().hue} 40% 45%)`;
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    if (state === 'done') {
      const colors = ['#ffd66b', '#ff9f68', '#8fd3ff'];
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI * 2 * i) / 6 + now / 900;
        const radius = 64 + Math.sin(now / 300 + i) * 6;
        const alpha = 0.5 + 0.5 * Math.sin(now / 220 + i);
        drawSparkle(
          centerX + Math.cos(angle) * radius,
          centerY + Math.sin(angle) * radius * 0.72,
          6,
          colors[i % colors.length],
          alpha,
        );
      }
    }

    if (state === 'pet') {
      for (let i = 0; i < 3; i += 1) {
        const progress = ((now / 1400 + i / 3) % 1);
        drawHeart(centerX - 28 + i * 28, centerY - 44 - progress * 34, 5.5, 1 - progress);
      }
    }

    if (state === 'offline') {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now / 700);
      ctx.fillStyle = '#5d5852';
      ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('z z z', centerX + 44, centerY - 44);
      ctx.restore();
    }
  }

  function drawPet(now, state) {
    const palette = currentPalette();
    const sprite = snapshot && snapshot.pet && snapshot.pet.sprite;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const baseY = height - 40;
    const bobTable = {
      idle: Math.sin(now / 1100) * 2,
      thinking: Math.sin(now / 700) * 3,
      working: Math.abs(Math.sin(now / 130)) * 5,
      'needs-you': Math.abs(Math.sin(now / 260)) * 15,
      done: Math.abs(Math.sin(now / 200)) * 9,
      error: 0,
      pet: Math.sin(now / 180) * 4,
      offline: Math.sin(now / 1800) * 1,
    };
    const bob = bobTable[state] || 0;
    const shake = state === 'error' ? Math.sin(now / 38) * 3 : 0;
    const centerX = width / 2 + shake;
    const centerY = baseY - 48 * PET_SCALE - bob;
    const tilt = state === 'thinking' ? -0.07 : 0;

    drawShadow(width / 2, baseY, bob);

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(tilt);
    const squash = 1 + Math.sin(now / 320) * 0.015;
    ctx.scale(1 / squash, squash);

    if (sprite && sprite.type === 'image' && customImage) {
      const size = 128;
      const scale = Math.min(size / customImage.naturalWidth, size / customImage.naturalHeight);
      const drawWidth = customImage.naturalWidth * scale;
      const drawHeight = customImage.naturalHeight * scale;
      ctx.drawImage(customImage, -drawWidth / 2, -drawHeight / 2 - 2, drawWidth, drawHeight);
    } else {
      ctx.scale(PET_SCALE, PET_SCALE);
      drawBackBits(palette.variant, palette.hue, palette.hue2);

      const gradient = ctx.createLinearGradient(0, -46, 0, 45);
      gradient.addColorStop(0, `hsl(${palette.hue} 72% 79%)`);
      gradient.addColorStop(1, `hsl(${palette.hue} 62% 62%)`);
      ctx.fillStyle = gradient;
      ctx.strokeStyle = `hsl(${palette.hue} 42% 38%)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, 52, 45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = `hsla(${palette.hue2} 80% 62% / 0.32)`;
      [-30, 30].forEach((side) => {
        ctx.beginPath();
        ctx.ellipse(side, 17, 8, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = `hsl(${palette.hue} 55% 52%)`;
      [-22, 22].forEach((side) => {
        ctx.beginPath();
        ctx.ellipse(side, 44, 12, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      });

      drawFace(now, state, palette.hue);
      if (state === 'working') drawKeyboard(now, palette.hue);
    }
    ctx.restore();

    drawEffects(now, state, centerX, centerY);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const width = window.innerWidth;
    const height = window.innerHeight;
    ctx.clearRect(0, 0, width, height);
    drawPet(now, stateAt(now));
    if (bubbleUntil && now > bubbleUntil) hideBubble();
  }

  requestAnimationFrame(frame);

  // Drag vs. click: a few pixels of movement means drag, otherwise pet.
  let pointer = null;

  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointer = { startX: event.screenX, startY: event.screenY, moved: false };
    window.buffy.dragStart(event.screenX, event.screenY);
  });

  document.addEventListener('pointermove', (event) => {
    if (!pointer) return;
    if (!pointer.moved && Math.hypot(event.screenX - pointer.startX, event.screenY - pointer.startY) > 4) {
      pointer.moved = true;
      document.body.classList.add('dragging');
    }
    if (pointer.moved) window.buffy.dragMove(event.screenX, event.screenY);
  });

  document.addEventListener('pointerup', () => {
    if (!pointer) return;
    const moved = pointer.moved;
    pointer = null;
    document.body.classList.remove('dragging');
    window.buffy.dragEnd();
    if (!moved) petIt();
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
