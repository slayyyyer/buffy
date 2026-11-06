/* global window, document, performance, requestAnimationFrame */
(function main() {
  'use strict';

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const bubbleEl = document.getElementById('bubble');
  const textEl = document.getElementById('text');
  const sourceEl = document.getElementById('source');
  const PET_SCALE = 1.2;

  const DEFAULT_MESSAGES = {
    'needs-you': 'I need you for something.',
    done: 'Done! Nice one.',
    error: 'Something broke.',
    thinking: 'Thinking…',
    working: 'Working…',
  };

  // Buffy's default look: a pink princess-cloud mascot with a pixel-screen face.
  const GIRLY = {
    hue: 338,
    hue2: 278,
  };

  const MASCOT = {
    outline: '#7a2556',
    screen: '#3d102d',
    screenPink: '#ff8ccb',
    pink: '#f47fbd',
    pinkLight: '#ffc0e1',
    pinkDeep: '#dd4f9d',
    blue: '#82cdf2',
    blueLight: '#d0f1ff',
    blueDeep: '#4b9ac9',
    cream: '#fff1d2',
    creamDeep: '#e7c79c',
    gold: '#ffd36a',
    goldDeep: '#b77a24',
    red: '#e84179',
    redDeep: '#ad2757',
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
    const fallback = paletteFromSeed(seed);
    const variant = sprite && sprite.palette && Number.isFinite(sprite.palette.variant)
      ? sprite.palette.variant
      : fallback.variant;
    return { hue: GIRLY.hue, hue2: GIRLY.hue2, variant };
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

  function drawBow(now, hue) {
    const ink = `hsl(${hue} 48% 27%)`;
    const ribbon = `hsl(${hue} 74% 68%)`;
    const light = `hsl(${hue} 85% 82%)`;
    const dark = `hsl(${hue} 55% 40%)`;
    const sway = Math.sin(now / 850) * 0.02;

    ctx.save();
    ctx.translate(0, -61);
    ctx.rotate(sway);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink;

    // Ribbon tails.
    [-1, 1].forEach((side) => {
      ctx.fillStyle = ribbon;
      ctx.beginPath();
      ctx.moveTo(side * 4, 1);
      ctx.quadraticCurveTo(side * 12, 9, side * 17, 18);
      ctx.lineTo(side * 8, 14);
      ctx.lineTo(side * 5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    // Two rounded loops.
    [-1, 1].forEach((side) => {
      ctx.fillStyle = ribbon;
      ctx.beginPath();
      ctx.moveTo(side * 4, -5);
      ctx.bezierCurveTo(side * 18, -20, side * 34, -15, side * 30, -2);
      ctx.bezierCurveTo(side * 27, 8, side * 14, 8, side * 4, 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = light;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(side * 11, -10);
      ctx.quadraticCurveTo(side * 21, -13, side * 25, -5);
      ctx.stroke();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
    });

    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(0, -1.5, 6.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.ellipse(-2, -4, 2, 3, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(7, -6, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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

    if (state !== 'error' && state !== 'offline') {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      [-1, 1].forEach((side) => {
        ctx.beginPath();
        ctx.moveTo(side * 23, eyeY - 2);
        ctx.lineTo(side * 28, eyeY - 7);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(side * 24, eyeY + 1);
        ctx.lineTo(side * 30, eyeY - 2);
        ctx.stroke();
      });
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

  function cloudPath(cx, cy, rx, ry, lobes) {
    const step = (Math.PI * 2) / lobes;
    ctx.beginPath();
    for (let i = 0; i <= lobes; i += 1) {
      const angle = -Math.PI / 2 + i * step;
      const x = cx + Math.cos(angle) * rx;
      const y = cy + Math.sin(angle) * ry;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        const mid = angle - step / 2;
        ctx.quadraticCurveTo(
          cx + Math.cos(mid) * (rx + 6),
          cy + Math.sin(mid) * (ry + 6),
          x,
          y,
        );
      }
    }
    ctx.closePath();
  }

  function drawCloudHead() {
    ctx.save();
    const gradient = ctx.createLinearGradient(0, -54, 0, 14);
    gradient.addColorStop(0, '#ffd3eb');
    gradient.addColorStop(0.55, '#fb9dd1');
    gradient.addColorStop(1, '#ee69b0');
    cloudPath(0, -20, 45, 33, 12);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = MASCOT.outline;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#8e235f';
    ctx.beginPath();
    ctx.ellipse(0, 1, 32, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    [
      [-26, -39, 3, 3],
      [-18, -46, 2, 2],
      [-11, -49, 2, 3],
      [23, -37, 2, 2],
      [31, -29, 2, 2],
    ].forEach(([x, y, w, h]) => ctx.fillRect(x, y, w, h));

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    [-30, -22, -14].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, -37);
      ctx.quadraticCurveTo(x + 3, -43, x + 9, -46);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawHeadphones() {
    [-1, 1].forEach((side) => {
      const x = side * 44;
      ctx.save();
      ctx.shadowColor = 'rgba(255, 62, 162, 0.8)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#e82b83';
      ctx.strokeStyle = MASCOT.outline;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(x, -17, 10.5, 10.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = '#ff9ed4';
      ctx.strokeStyle = '#b82870';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(x, -17, 7, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.beginPath();
      ctx.ellipse(x - 2.5, -20.5, 2.2, 1.5, -0.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawPixelFace(now, state) {
    ctx.save();
    ctx.fillStyle = MASCOT.screen;
    ctx.strokeStyle = MASCOT.outline;
    ctx.lineWidth = 2.2;
    roundRect(-25, -42, 50, 31, 9);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 139, 207, 0.24)';
    ctx.lineWidth = 1;
    roundRect(-22.5, -39.5, 45, 26, 7);
    ctx.stroke();

    const px = (x, y, w, h, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    };
    const white = '#ffe9f7';
    const pink = '#ff8dcc';
    const glow = '#ff4da3';
    const muted = '#8e657e';
    const happy = state === 'pet' || state === 'done';
    const blink = now % 4300 < 120 && !['needs-you', 'error', 'pet', 'done', 'offline'].includes(state);
    const eyeY = -31;

    const openEye = (side, wide) => {
      const x = side * 13;
      px(x - 4, eyeY - 5, 8, 9, white);
      px(x - 5, eyeY - 3, 10, 5, white);
      px(x - 2, eyeY - 4, 4, 6, glow);
      px(x - 1, eyeY - 4, 2, 2, '#ffffff');
      px(x - 5, eyeY - 7, 2, 2, pink);
      px(x + 3, eyeY - 7, 2, 2, pink);
      if (wide) px(x - 6, eyeY - 1, 2, 2, pink);
    };
    const happyEye = (side) => {
      const x = side * 13;
      px(x - 5, eyeY - 1, 2, 2, pink);
      px(x - 3, eyeY - 3, 2, 2, pink);
      px(x - 1, eyeY - 4, 3, 2, pink);
      px(x + 2, eyeY - 3, 2, 2, pink);
      px(x + 4, eyeY - 1, 2, 2, pink);
    };
    const closedEye = (side) => {
      const x = side * 13;
      px(x - 4, eyeY, 8, 2, pink);
      px(x - 2, eyeY - 1, 4, 2, pink);
    };
    const crossEye = (side) => {
      const x = side * 13;
      for (let i = 0; i < 4; i += 1) {
        px(x - 4 + i * 2, eyeY - 4 + i * 2, 2, 2, pink);
        px(x + 4 - i * 2, eyeY - 4 + i * 2, 2, 2, pink);
      }
    };

    if (state === 'error') {
      crossEye(-1);
      crossEye(1);
    } else if (state === 'offline') {
      [-1, 1].forEach((side) => {
        const x = side * 13;
        px(x - 4, eyeY - 1, 8, 2, muted);
      });
    } else if (happy) {
      happyEye(-1);
      happyEye(1);
    } else if (blink) {
      closedEye(-1);
      closedEye(1);
    } else {
      openEye(-1, state === 'needs-you');
      openEye(1, state === 'needs-you');
    }

    [-1, 1].forEach((side) => {
      px(side * 20 - 3, -20, 5, 2, 'rgba(255, 104, 176, 0.65)');
      px(side * 20 - 1, -18, 3, 2, 'rgba(255, 104, 176, 0.55)');
    });

    if (state === 'error') {
      px(-4, -15, 2, 2, pink);
      px(-2, -17, 4, 2, pink);
      px(2, -15, 2, 2, pink);
    } else if (state === 'offline') {
      px(-4, -16, 8, 2, muted);
    } else if (state === 'thinking') {
      px(-4, -17, 8, 2, pink);
    } else if (state === 'needs-you') {
      px(-2, -18, 4, 4, glow);
      px(-1, -17, 2, 2, '#fff0fa');
    } else if (state === 'working') {
      px(-1, -18, 3, 3, glow);
    } else {
      px(-4, -16, 2, 2, pink);
      px(-2, -15, 4, 2, pink);
      px(2, -16, 2, 2, pink);
    }

    px(-21, -37, 2, 2, 'rgba(255, 151, 213, 0.5)');
    px(19, -37, 2, 2, 'rgba(255, 151, 213, 0.5)');
    ctx.restore();
  }

  function drawJewelHeart(x, y, size, fill, stroke) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.65);
    ctx.bezierCurveTo(x - size * 1.35, y - size * 0.35, x - size * 0.4, y - size, x, y - size * 0.35);
    ctx.bezierCurveTo(x + size * 0.4, y - size, x + size * 1.35, y - size * 0.35, x, y + size * 0.65);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillRect(x - size * 0.25, y - size * 0.3, Math.max(1, size * 0.2), Math.max(1, size * 0.2));
    ctx.restore();
  }

  function drawTiara() {
    ctx.save();
    ctx.fillStyle = MASCOT.gold;
    ctx.strokeStyle = MASCOT.goldDeep;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-21, -46);
    ctx.lineTo(-17, -59);
    ctx.lineTo(-8, -52);
    ctx.lineTo(0, -65);
    ctx.lineTo(8, -52);
    ctx.lineTo(17, -59);
    ctx.lineTo(21, -46);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    roundRect(-22, -49, 44, 5.5, 2.7);
    ctx.fillStyle = MASCOT.gold;
    ctx.fill();
    ctx.strokeStyle = MASCOT.goldDeep;
    ctx.stroke();

    [-20, 20].forEach((x) => {
      ctx.fillStyle = MASCOT.gold;
      ctx.strokeStyle = MASCOT.goldDeep;
      ctx.beginPath();
      ctx.arc(x, -52, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    drawJewelHeart(0, -54, 6.2, '#ff4e9f', MASCOT.goldDeep);
    drawJewelHeart(-14, -51, 4, '#ff7bb8', MASCOT.goldDeep);
    drawJewelHeart(14, -51, 4, '#ff7bb8', MASCOT.goldDeep);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillRect(-8, -55, 2, 2);
    ctx.restore();
  }

  function drawDress() {
    ctx.save();
    ctx.lineJoin = 'round';
    const hem = (left, right, y, depth, count) => {
      const step = (right - left) / count;
      ctx.moveTo(left, y);
      for (let i = 0; i < count; i += 1) {
        ctx.quadraticCurveTo(left + step * (i + 0.5), y + depth, left + step * (i + 1), y);
      }
    };

    ctx.fillStyle = MASCOT.cream;
    ctx.strokeStyle = MASCOT.creamDeep;
    ctx.lineWidth = 1.2;
    [-8, 8].forEach((x) => {
      ctx.beginPath();
      ctx.ellipse(x, 9, 8, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    [-22, 22].forEach((x) => {
      ctx.fillStyle = MASCOT.cream;
      ctx.strokeStyle = MASCOT.outline;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(x, 16, 8, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.beginPath();
      ctx.ellipse(x - 2, 14, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.beginPath();
    ctx.moveTo(-13, 20);
    ctx.bezierCurveTo(-29, 25, -35, 38, -30, 46);
    hem(-30, 30, 46, 3.5, 5);
    ctx.bezierCurveTo(35, 38, 29, 25, 13, 20);
    ctx.closePath();
    ctx.fillStyle = MASCOT.blueDeep;
    ctx.strokeStyle = MASCOT.outline;
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-12, 21);
    ctx.bezierCurveTo(-23, 28, -28, 38, -23, 44);
    hem(-23, 23, 44, 3, 4);
    ctx.bezierCurveTo(28, 38, 23, 28, 12, 21);
    ctx.closePath();
    ctx.fillStyle = MASCOT.blue;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    hem(-23, 23, 44, 3, 4);
    ctx.strokeStyle = MASCOT.cream;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-13, 6);
    ctx.quadraticCurveTo(-16, 16, -12, 23);
    ctx.quadraticCurveTo(0, 28, 12, 23);
    ctx.quadraticCurveTo(16, 16, 13, 6);
    ctx.closePath();
    ctx.fillStyle = MASCOT.blueLight;
    ctx.fill();
    ctx.strokeStyle = MASCOT.outline;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle = MASCOT.cream;
    ctx.strokeStyle = MASCOT.creamDeep;
    ctx.lineWidth = 1;
    roundRect(-13, 20, 26, 3.5, 1.7);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    roundRect(-4, 8, 8, 12, 2);
    ctx.fill();

    drawJewelHeart(0, 15, 4.7, '#66c9ff', MASCOT.cream);

    ctx.fillStyle = MASCOT.cream;
    [-18, 0, 18].forEach((x) => {
      ctx.beginPath();
      ctx.arc(x, 42, 1.2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawShoes() {
    ctx.save();
    [-14, 14].forEach((x) => {
      ctx.fillStyle = MASCOT.red;
      ctx.strokeStyle = MASCOT.outline;
      ctx.lineWidth = 2;
      roundRect(x - 8, 44, 16, 11, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = MASCOT.cream;
      ctx.strokeStyle = MASCOT.creamDeep;
      ctx.lineWidth = 0.8;
      roundRect(x - 8, 52, 16, 3, 1.5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.beginPath();
      ctx.ellipse(x - 2, 48, 3, 1.5, -0.3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawHands() {
    [-1, 1].forEach((side) => {
      const x = side * 31;
      ctx.strokeStyle = MASCOT.creamDeep;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(side * 23, 18);
      ctx.lineTo(x, 26);
      ctx.stroke();

      ctx.fillStyle = MASCOT.pink;
      ctx.strokeStyle = MASCOT.outline;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(x, 28, 6.5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.beginPath();
      ctx.arc(x - 2, 25.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawPrincessDress() {
    ctx.save();
    ctx.lineJoin = 'round';
    const hem = (left, right, y, depth, count, start = true) => {
      const step = (right - left) / count;
      if (start) ctx.moveTo(left, y);
      for (let i = 0; i < count; i += 1) {
        ctx.quadraticCurveTo(left + step * (i + 0.5), y + depth, left + step * (i + 1), y);
      }
    };

    // Cream collar peeking out beneath the bodice.
    ctx.fillStyle = MASCOT.cream;
    ctx.strokeStyle = MASCOT.creamDeep;
    ctx.lineWidth = 1.2;
    roundRect(-12, 6, 24, 7, 3.5);
    ctx.fill();
    ctx.stroke();

    // Puffed sleeves.
    [-21, 21].forEach((x) => {
      ctx.fillStyle = MASCOT.cream;
      ctx.strokeStyle = MASCOT.outline;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(x, 15, 7.5, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = MASCOT.blue;
      ctx.beginPath();
      ctx.ellipse(x, 17, 5, 3, 0, 0, Math.PI);
      ctx.fill();
    });

    // Deep-blue back skirt.
    ctx.beginPath();
    ctx.moveTo(-12, 19);
    ctx.bezierCurveTo(-28, 24, -33, 33, -29, 39);
    hem(-29, 29, 39, 3, 5, false);
    ctx.bezierCurveTo(33, 33, 28, 24, 12, 19);
    ctx.closePath();
    ctx.fillStyle = MASCOT.blueDeep;
    ctx.strokeStyle = MASCOT.outline;
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    // Lighter overskirt.
    ctx.beginPath();
    ctx.moveTo(-10, 20);
    ctx.bezierCurveTo(-20, 25, -24, 32, -21, 38);
    hem(-21, 21, 38, 2.5, 3, false);
    ctx.bezierCurveTo(24, 32, 20, 25, 10, 20);
    ctx.closePath();
    ctx.fillStyle = MASCOT.blue;
    ctx.fill();
    ctx.stroke();

    // Cream scalloped hem.
    ctx.beginPath();
    hem(-21, 21, 38, 2.5, 3);
    ctx.strokeStyle = MASCOT.cream;
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // Bodice.
    ctx.beginPath();
    ctx.moveTo(-12, 8);
    ctx.quadraticCurveTo(-14, 15, -10, 22);
    ctx.quadraticCurveTo(0, 26, 10, 22);
    ctx.quadraticCurveTo(14, 15, 12, 8);
    ctx.closePath();
    ctx.fillStyle = MASCOT.blueLight;
    ctx.fill();
    ctx.strokeStyle = MASCOT.outline;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // White V collar.
    ctx.beginPath();
    ctx.moveTo(-9, 8);
    ctx.lineTo(0, 13);
    ctx.lineTo(9, 8);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 9);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fillStyle = MASCOT.cream;
    ctx.fill();
    ctx.strokeStyle = MASCOT.creamDeep;
    ctx.lineWidth = 0.9;
    ctx.stroke();

    ctx.fillStyle = MASCOT.cream;
    ctx.strokeStyle = MASCOT.creamDeep;
    ctx.lineWidth = 1;
    roundRect(-11, 20, 22, 3, 1.5);
    ctx.fill();
    ctx.stroke();

    drawJewelHeart(0, 15, 4.2, '#66c9ff', MASCOT.cream);

    ctx.fillStyle = MASCOT.cream;
    [-15, 0, 15].forEach((x) => {
      ctx.beginPath();
      ctx.arc(x, 36, 1.1, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawPrincessShoes() {
    ctx.save();
    ctx.fillStyle = MASCOT.pink;
    ctx.fillRect(-18, 36, 6, 7);
    ctx.fillRect(12, 36, 6, 7);

    [-14, 14].forEach((x) => {
      ctx.fillStyle = MASCOT.red;
      ctx.strokeStyle = MASCOT.outline;
      ctx.lineWidth = 2;
      roundRect(x - 8, 42, 16, 11, 5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = MASCOT.cream;
      ctx.strokeStyle = MASCOT.creamDeep;
      ctx.lineWidth = 0.8;
      roundRect(x - 8, 50, 16, 3, 1.5);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.ellipse(x - 2, 46, 3, 1.5, -0.3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
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
    if (state === 'idle') {
      const pulse = 0.18 + 0.12 * Math.sin(now / 900);
      drawSparkle(centerX - 52, centerY - 36, 3, '#ffc2da', pulse);
      drawSparkle(centerX + 54, centerY - 30, 2.2, '#fff0b8', pulse * 0.9);
    }

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
      drawCloudHead();
      drawHeadphones();
      drawPixelFace(now, state);
      drawTiara();
      drawPrincessDress();
      drawPrincessShoes();
      if (state !== 'working') drawHands();
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
