/* global globalThis */
(function characterModule() {
  'use strict';

  let PET_SCALE = 1.2;
  const WAKE_MS = 900;
  let ctx = null;
  let wardrobe = {};
  let snapshot = null;
  let customImage = null;
  let cursorLocal = null;
  let wakeAt = 0;
  let gazeX = 0;
  let gazeY = 0;
  let viewportWidth = 300;
  let viewportHeight = 330;
  let viewportBaseY = null;

  const THEMES = {
    rose: {
      hue: 338,
      hue2: 278,
      mascot: {},
    },
    lavender: {
      hue: 272,
      hue2: 310,
      mascot: {
        outline: '#5a3a73',
        screen: '#2f1b3b',
        cloudTop: '#eadcff',
        cloudMid: '#d2b5f8',
        cloudLow: '#b18ce8',
        cloudShadow: '#5a3a73',
        pink: '#c9a7f2',
        pinkLight: '#eadcff',
        pinkDeep: '#a77ae0',
        blue: '#b8c8ff',
        blueLight: '#e7edff',
        blueDeep: '#8e9fe6',
        red: '#d879b1',
        redDeep: '#a55788',
      },
    },
    mint: {
      hue: 158,
      hue2: 190,
      mascot: {
        outline: '#2f6557',
        screen: '#172f2a',
        cloudTop: '#d9fff1',
        cloudMid: '#b7f2dc',
        cloudLow: '#83d3b6',
        cloudShadow: '#2f6557',
        pink: '#a8e6cf',
        pinkLight: '#d9fff1',
        pinkDeep: '#66bfa0',
        blue: '#bfe6ff',
        blueLight: '#e8f8ff',
        blueDeep: '#7eb8d9',
        red: '#e88fa9',
        redDeep: '#b35b78',
      },
    },
    sky: {
      hue: 205,
      hue2: 265,
      mascot: {
        outline: '#2f5472',
        screen: '#172b3d',
        cloudTop: '#dff2ff',
        cloudMid: '#b9e4ff',
        cloudLow: '#7fc7ee',
        cloudShadow: '#2f5472',
        pink: '#a9d8ff',
        pinkLight: '#dff2ff',
        pinkDeep: '#74b6e6',
        blue: '#c9c1ff',
        blueLight: '#ece8ff',
        blueDeep: '#9a90d8',
        red: '#e88fa9',
        redDeep: '#b35b78',
      },
    },
    butter: {
      hue: 38,
      hue2: 330,
      mascot: {
        outline: '#7a5a24',
        screen: '#3b2a12',
        cloudTop: '#fff7d9',
        cloudMid: '#ffe8a8',
        cloudLow: '#f5c96b',
        cloudShadow: '#7a5a24',
        pink: '#f6c76e',
        pinkLight: '#fff3cf',
        pinkDeep: '#d9a441',
        blue: '#ffd98a',
        blueLight: '#fff8e4',
        blueDeep: '#e0b45b',
        red: '#e88f7a',
        redDeep: '#b35b4a',
      },
    },
    midnight: {
      hue: 245,
      hue2: 285,
      mascot: {
        outline: '#241d45',
        screen: '#121027',
        cloudTop: '#b9a6ff',
        cloudMid: '#8f7be0',
        cloudLow: '#6a58bd',
        cloudShadow: '#241d45',
        pink: '#c9b7ff',
        pinkLight: '#e8e0ff',
        pinkDeep: '#9a83e0',
        blue: '#a9c7ff',
        blueLight: '#e3edff',
        blueDeep: '#7b95d8',
        red: '#e88fb8',
        redDeep: '#b35b88',
      },
    },
  };
  const DEFAULTS = { outfit: 'princess', bow: 'none', hat: 'none', glasses: 'none', wand: 'none', theme: 'rose' };
  const BOW_COLORS = {
    pink: '#ff76b9',
    lavender: '#b488ee',
    mint: '#66d2a8',
    gold: '#ffd36a',
  };

  const MASCOT = {
    outline: '#7a2556',
    screen: '#3d102d',
    screenPink: '#ff8ccb',
    pink: '#f47fbd',
    pinkLight: '#ffc0e1',
    pinkDeep: '#dd4f9d',
    cloudTop: '#ffd3eb',
    cloudMid: '#fb9dd1',
    cloudLow: '#ee69b0',
    cloudShadow: '#8e235f',
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

  const MASCOT_BASE = { ...MASCOT };

  function applyLook(next) {
    wardrobe = { ...DEFAULTS, ...(next && typeof next === 'object' ? next : {}) };
    const theme = THEMES[wardrobe.theme] || THEMES.rose;
    Object.assign(MASCOT, MASCOT_BASE, theme.mascot);
  }

  function currentPalette() {
    const theme = THEMES[wardrobe.theme] || THEMES.rose;
    return { hue: theme.hue, hue2: theme.hue2 };
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
    } else if (hobbyId === 'stretch') {
      ctx.beginPath();
      ctx.ellipse(0, mouthY, 5, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (hobbyId === 'coffee' && coffeeLift > 0.45) {
      ctx.beginPath();
      ctx.arc(0, mouthY - 3, 6, 0.15 * Math.PI, 0.85 * Math.PI);
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
    gradient.addColorStop(0, MASCOT.cloudTop);
    gradient.addColorStop(0.55, MASCOT.cloudMid);
    gradient.addColorStop(1, MASCOT.cloudLow);
    cloudPath(0, -20, 45, 33, 12);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = MASCOT.outline;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = MASCOT.cloudShadow;
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
      drawJewelHeart(x, -19, 11.8, '#e82b83', MASCOT.outline);
      ctx.restore();

      drawJewelHeart(x, -19, 8, '#ff9ed4', '#b82870');
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.beginPath();
      ctx.ellipse(x - 2.3, -21.5, 1.8, 1.2, -0.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawPixelFace(now, state, centerX, centerY, hobby) {
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
    const hobbyId = hobby && hobby.id;
    const coffeeLift = hobbyId === 'coffee' ? coffeeLiftAt(now, hobby) : 0;
    const hobbyHappy = hobbyId === 'stretch' || (hobbyId === 'coffee' && coffeeLift > 0.45);
    const blink = now % 4300 < 120 && !['needs-you', 'error', 'pet', 'done', 'offline', 'sleepy'].includes(state);
    const eyeY = -31;
    const faceY = centerY - 26 * PET_SCALE;
    const gazeDistance = cursorLocal
      ? Math.hypot(cursorLocal.x - centerX, cursorLocal.y - faceY)
      : 0;
    const gazeReach = cursorLocal && gazeDistance > 1 ? Math.min(1, gazeDistance / 90) : 0;
    const targetGazeX = cursorLocal && gazeDistance > 1
      ? ((cursorLocal.x - centerX) / gazeDistance) * 2 * gazeReach
      : 0;
    const targetGazeY = cursorLocal && gazeDistance > 1
      ? ((cursorLocal.y - faceY) / gazeDistance) * 1.2 * gazeReach
      : 0;
    gazeX += (targetGazeX - gazeX) * 0.18;
    gazeY += (targetGazeY - gazeY) * 0.18;
    const lookX = Math.round(gazeX);
    const lookY = Math.round(gazeY);

    const openEye = (side, wide, offsetX, offsetY) => {
      const x = side * 13;
      px(x - 4, eyeY - 5, 8, 9, white);
      px(x - 5, eyeY - 3, 10, 5, white);
      px(x - 2 + offsetX, eyeY - 4 + offsetY, 2, 2, glow);
      px(x + 1 + offsetX, eyeY - 4 + offsetY, 2, 2, glow);
      px(x - 3 + offsetX, eyeY - 2 + offsetY, 6, 2, glow);
      px(x - 2 + offsetX, eyeY + offsetY, 5, 2, glow);
      px(x - 1 + offsetX, eyeY + 2 + offsetY, 3, 1, glow);
      px(x - 1 + offsetX, eyeY - 4 + offsetY, 1, 1, '#ffffff');
      px(x + 2 + offsetX, eyeY - 1 + offsetY, 1, 1, '#ffffff');
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
    const sleepingEye = (side) => {
      const x = side * 13;
      px(x - 4, eyeY, 8, 2, pink);
      px(x - 2, eyeY - 1, 4, 1, pink);
      px(x + side * 6, eyeY - 2, 2, 1, pink);
    };
    const crossEye = (side) => {
      const x = side * 13;
      for (let i = 0; i < 4; i += 1) {
        px(x - 4 + i * 2, eyeY - 4 + i * 2, 2, 2, pink);
        px(x + 4 - i * 2, eyeY - 4 + i * 2, 2, 2, pink);
      }
    };

    if (state === 'sleepy') {
      sleepingEye(-1);
      sleepingEye(1);
    } else if (state === 'error') {
      crossEye(-1);
      crossEye(1);
    } else if (state === 'offline') {
      [-1, 1].forEach((side) => {
        const x = side * 13;
        px(x - 4, eyeY - 1, 8, 2, muted);
      });
    } else if (hobbyHappy) {
      happyEye(-1);
      happyEye(1);
    } else if (happy) {
      happyEye(-1);
      happyEye(1);
    } else if (blink) {
      closedEye(-1);
      closedEye(1);
    } else {
      const wide = state === 'needs-you' || state === 'wake';
      openEye(-1, wide, lookX, lookY);
      openEye(1, wide, lookX, lookY);
    }

    if (state !== 'error' && state !== 'offline' && state !== 'sleepy' && !blink && !happy) {
      [-1, 1].forEach((side) => {
        const x = side * 13;
        px(x + side * 6, eyeY - 7, 3, 1, pink);
        px(x + side * 8, eyeY - 9, 2, 1, pink);
        px(x + side * 6, eyeY - 4, 2, 1, pink);
      });
    }

    [-1, 1].forEach((side) => {
      const x = side * 20;
      px(x - 3, -22, 2, 2, 'rgba(255, 104, 176, 0.78)');
      px(x + 1, -22, 2, 2, 'rgba(255, 104, 176, 0.78)');
      px(x - 4, -20, 8, 2, 'rgba(255, 104, 176, 0.68)');
      px(x - 3, -18, 6, 2, 'rgba(255, 104, 176, 0.6)');
      px(x - 2, -16, 4, 2, 'rgba(255, 104, 176, 0.52)');
      px(x - 1, -14, 2, 2, 'rgba(255, 104, 176, 0.44)');
    });

    if (state === 'error') {
      px(-4, -15, 2, 2, pink);
      px(-2, -17, 4, 2, pink);
      px(2, -15, 2, 2, pink);
    } else if (state === 'offline') {
      px(-4, -16, 8, 2, muted);
    } else if (state === 'sleepy') {
      px(-1, -16, 2, 2, pink);
      px(0, -15, 1, 1, MASCOT.screen);
    } else if (state === 'wake') {
      px(-2, -17, 4, 4, pink);
      px(-1, -16, 2, 2, MASCOT.screen);
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

  function drawMiniBow(x, y, size, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.strokeStyle = MASCOT.outline;
    ctx.lineWidth = 1;

    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(side * size * 0.55, size * 1.15, side * size * 0.95, size * 1.4);
      ctx.lineTo(side * size * 0.18, size * 0.95);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(side * size * 1.3, -size, side * size * 1.6, size * 0.8, 0, size * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    [-1, 1].forEach((side) => {
      ctx.beginPath();
      ctx.ellipse(side * size * 0.75, -size * 0.18, size * 0.25, size * 0.12, side * -0.35, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = MASCOT.gold;
    ctx.strokeStyle = MASCOT.goldDeep;
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.35, size * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
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

  function drawBeret() {
    ctx.save();
    ctx.translate(-28, -54);
    ctx.rotate(-0.18);
    ctx.fillStyle = MASCOT.pinkDeep;
    ctx.strokeStyle = MASCOT.outline;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, 13.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = MASCOT.pinkLight;
    ctx.beginPath();
    ctx.ellipse(-3.5, -2, 6.5, 2.5, -0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = MASCOT.cream;
    ctx.strokeStyle = MASCOT.creamDeep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 5.5, 12, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = MASCOT.gold;
    ctx.strokeStyle = MASCOT.goldDeep;
    ctx.beginPath();
    ctx.arc(1, -7, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawPartyHat() {
    ctx.save();
    ctx.translate(-30, -48);
    ctx.rotate(-0.16);
    ctx.beginPath();
    ctx.moveTo(-10, 7);
    ctx.quadraticCurveTo(-4, -10, 2, -30);
    ctx.quadraticCurveTo(7, -10, 11, 7);
    ctx.closePath();
    ctx.fillStyle = MASCOT.cream;
    ctx.strokeStyle = MASCOT.outline;
    ctx.lineWidth = 1.6;
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.clip();
    ctx.fillStyle = MASCOT.pink;
    for (let y = -12; y < 10; y += 10) {
      ctx.beginPath();
      ctx.moveTo(-15, y);
      ctx.lineTo(15, y - 10);
      ctx.lineTo(15, y - 5);
      ctx.lineTo(-15, y + 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = MASCOT.blue;
    ctx.strokeStyle = MASCOT.outline;
    ctx.beginPath();
    ctx.ellipse(1, 7, 11, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = MASCOT.gold;
    ctx.strokeStyle = MASCOT.goldDeep;
    ctx.beginPath();
    ctx.arc(2, -32, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawGlasses() {
    const style = wardrobe.glasses;
    if (!style || style === 'none') return;
    ctx.save();
    ctx.strokeStyle = style === 'round' ? '#5b6bb5' : style === 'heart' ? '#b33569' : '#b77a24';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';

    const heartPath = (x, y, size) => {
      ctx.beginPath();
      ctx.moveTo(x, y + size * 0.65);
      ctx.bezierCurveTo(x - size * 1.3, y - size * 0.35, x - size * 0.4, y - size, x, y - size * 0.3);
      ctx.bezierCurveTo(x + size * 0.4, y - size, x + size * 1.3, y - size * 0.35, x, y + size * 0.65);
      ctx.closePath();
    };
    const starPath = (x, y, size) => {
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const angle = -Math.PI / 2 + (Math.PI / 5) * i;
        const radius = i % 2 === 0 ? size : size * 0.45;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    [-1, 1].forEach((side) => {
      const x = side * 13;
      if (style === 'round') ctx.arc(x, -31, 8, 0, Math.PI * 2);
      else if (style === 'heart') heartPath(x, -31, 7);
      else starPath(x, -31, 8);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + side * 8, -33);
      ctx.lineTo(side * 24, -36);
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.moveTo(-5, -31);
    ctx.lineTo(5, -31);
    ctx.stroke();
    ctx.restore();
  }

  function drawSunHat() {
    ctx.save();
    ctx.translate(-27, -58);
    ctx.rotate(-0.12);
    ctx.fillStyle = '#f6dfae';
    ctx.strokeStyle = '#8a6a38';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 6, 26, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    roundRect(-12, -10, 24, 17, 7);
    ctx.fillStyle = '#f6dfae';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = MASCOT.pinkDeep;
    roundRect(-12, -3, 24, 4, 2);
    ctx.fill();
    ctx.fillStyle = MASCOT.cream;
    ctx.beginPath();
    ctx.arc(10, 1, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = MASCOT.gold;
    ctx.beginPath();
    ctx.arc(10, 1, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHat() {
    if (wardrobe.hat === 'beret') drawBeret();
    else if (wardrobe.hat === 'party') drawPartyHat();
    else if (wardrobe.hat === 'sunhat') drawSunHat();
  }

  function drawWardrobeBow() {
    const color = BOW_COLORS[wardrobe.bow];
    if (!color) return;
    ctx.save();
    ctx.translate(35, -38);
    ctx.rotate(0.18);
    ctx.shadowColor = 'rgba(122, 37, 86, 0.24)';
    ctx.shadowBlur = 2;
    drawMiniBow(0, 0, 7, color);
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

  function drawWand(handX, handY, tilt, style = 'star') {
    ctx.save();
    ctx.translate(handX, handY);
    ctx.rotate(-0.55 + tilt);
    ctx.strokeStyle = MASCOT.goldDeep;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(1, 4);
    ctx.lineTo(-16, -20);
    ctx.stroke();
    ctx.strokeStyle = MASCOT.cream;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.lineTo(-15, -19);
    ctx.stroke();
    if (style === 'heart') {
      drawJewelHeart(-18, -23, 6.8, '#e88fa9', MASCOT.goldDeep);
      drawSparkle(-22, -27, 3.2, MASCOT.gold, 0.9);
    } else {
      drawSparkle(-18, -23, 6.5, MASCOT.gold, 0.95);
      drawSparkle(-18, -23, 3.5, MASCOT.pink, 1);
    }
    ctx.restore();
  }

  function drawHands(now, state, hobby) {
    const hobbyId = hobby && hobby.id;
    const phase = hobby ? hobbyPhase(now, hobby) : 0;
    const coffeeLift = hobbyId === 'coffee' ? coffeeLiftAt(now, hobby) : 0;
    const waking = !hobby && state === 'wake';
    const wakeProgress = waking ? Math.min(1, Math.max(0, (now - wakeAt) / WAKE_MS)) : 0;
    const stretch = waking ? Math.sin(wakeProgress * Math.PI) : 0;
    [-1, 1].forEach((side) => {
      const waving = !hobby && state === 'wave' && side === 1;
      const swing = Math.sin(now / 120);
      let handX;
      let handY;
      let tilt;
      if (hobbyId === 'reading') {
        handX = side * 22;
        handY = 38;
        tilt = side * 0.15;
      } else if (hobbyId === 'coffee') {
        handX = side === 1 ? 32 : -24;
        handY = side === 1 ? 34 - coffeeLift * 7 : 29;
        tilt = side === 1 ? -0.18 : 0;
      } else if (hobbyId === 'stretch') {
        const lift = Math.sin(phase * Math.PI);
        handX = side * (36 + lift * 4);
        handY = -2 - lift * 5;
        tilt = side * 0.2;
      } else if (waving) {
        handX = 39 + swing * 1.5;
        handY = 6 + Math.cos(now / 110) * 1.2;
        tilt = -0.3 + swing * 0.12;
      } else {
        handX = side * (31 + stretch * 7);
        handY = 28 - stretch * 16;
        tilt = waking ? side * stretch * 0.16 : 0;
      }

      ctx.strokeStyle = MASCOT.creamDeep;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(side * 23, 18);
      if (hobby) ctx.quadraticCurveTo(side * 27, (18 + handY) / 2, handX, handY + 2);
      else if (waving) ctx.quadraticCurveTo(31, 14, handX - 2, handY + 2);
      else if (waking) ctx.quadraticCurveTo(side * 30, 17, handX, handY + 2);
      else ctx.lineTo(handX, 26);
      ctx.stroke();

      if (!hobby && side === -1 && wardrobe.wand && wardrobe.wand !== 'none') {
        drawWand(handX, handY, tilt, wardrobe.wand);
      }

      ctx.save();
      ctx.translate(handX, handY);
      ctx.rotate(tilt);
      ctx.fillStyle = MASCOT.pink;
      ctx.strokeStyle = MASCOT.outline;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.ellipse(0, 0, 6.5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (waving) {
        ctx.beginPath();
        ctx.arc(4.4, -4.4, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(6.4, -1.2, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.beginPath();
      ctx.arc(-2, -2.5, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      if (waving) {
        ctx.strokeStyle = 'rgba(255, 116, 181, 0.7)';
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(handX + 8, handY - 1, 5.5, -0.7, 0.35);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(handX + 11, handY - 5, 3.8, -0.65, 0.2);
        ctx.stroke();
      }
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

    drawMiniBow(0, 23, 6, '#ff6fb0');
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

      drawJewelHeart(x, 45, 2.7, MASCOT.gold, MASCOT.goldDeep);

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

  function drawCozy() {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#c9b7a4';
    roundRect(-18, 32, 7, 13, 3);
    ctx.fill();
    roundRect(11, 32, 7, 13, 3);
    ctx.fill();

    [-14, 14].forEach((x) => {
      ctx.fillStyle = '#f2b8a0';
      ctx.strokeStyle = '#7a4a38';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(x, 47, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.moveTo(-14, 7);
    ctx.quadraticCurveTo(-22, 11, -21, 31);
    ctx.lineTo(21, 31);
    ctx.quadraticCurveTo(22, 11, 14, 7);
    ctx.closePath();
    ctx.fillStyle = '#fff4e0';
    ctx.strokeStyle = '#7a4a38';
    ctx.lineWidth = 1.6;
    ctx.fill();
    ctx.stroke();

    [-1, 1].forEach((side) => {
      ctx.fillStyle = '#fff4e0';
      ctx.strokeStyle = '#7a4a38';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(side * 23, 22, 6, 9, side * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    ctx.fillStyle = '#e8d6bb';
    ctx.strokeStyle = '#b99a78';
    ctx.lineWidth = 1;
    roundRect(-21, 28, 42, 5, 2);
    ctx.fill();
    ctx.stroke();
    roundRect(-9, 5, 18, 5, 2.5);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(185, 154, 120, 0.6)';
    ctx.lineWidth = 0.8;
    [-10, 0, 10].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x, 12);
      ctx.lineTo(x, 27);
      ctx.stroke();
    });
    drawJewelHeart(12, 20, 3.8, '#ef9a8e', '#b35b78');
    ctx.restore();
  }

  function drawSleepover() {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#a98bd9';
    ctx.strokeStyle = '#4f3a73';
    ctx.lineWidth = 1.3;
    roundRect(-17, 30, 34, 13, 4);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-13, 7);
    ctx.quadraticCurveTo(-20, 12, -19, 30);
    ctx.lineTo(19, 30);
    ctx.quadraticCurveTo(20, 12, 13, 7);
    ctx.closePath();
    ctx.fillStyle = '#cbb7ee';
    ctx.strokeStyle = '#4f3a73';
    ctx.lineWidth = 1.6;
    ctx.fill();
    ctx.stroke();

    [-1, 1].forEach((side) => {
      ctx.fillStyle = '#cbb7ee';
      ctx.beginPath();
      ctx.ellipse(side * 22, 21, 6, 8, side * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    ctx.fillStyle = '#fff4e0';
    ctx.strokeStyle = '#b99a78';
    ctx.lineWidth = 1;
    roundRect(-9, 5, 18, 5, 2.5);
    ctx.fill();
    ctx.stroke();

    drawSparkle(-9, 15, 3.2, '#fff4e0', 0.95);
    drawSparkle(8, 22, 2.6, '#ffd36a', 0.9);
    drawSparkle(12, 13, 2.2, '#fff4e0', 0.8);

    [-14, 14].forEach((x) => {
      ctx.fillStyle = '#f2c6dd';
      ctx.strokeStyle = '#7a4a38';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(x, 47, 10, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawRainy() {
    ctx.save();
    ctx.lineJoin = 'round';
    [-14, 14].forEach((x) => {
      ctx.fillStyle = '#5b7f8e';
      ctx.strokeStyle = '#2f4a55';
      ctx.lineWidth = 1.4;
      roundRect(x - 8, 42, 16, 12, 4);
      ctx.fill();
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.moveTo(-13, 6);
    ctx.quadraticCurveTo(-26, 16, -28, 43);
    ctx.lineTo(28, 43);
    ctx.quadraticCurveTo(26, 16, 13, 6);
    ctx.closePath();
    ctx.fillStyle = '#ffd45e';
    ctx.strokeStyle = '#8a6a1e';
    ctx.lineWidth = 1.6;
    ctx.fill();
    ctx.stroke();

    [-1, 1].forEach((side) => {
      ctx.fillStyle = '#ffd45e';
      ctx.beginPath();
      ctx.ellipse(side * 23, 21, 6, 9, side * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    ctx.fillStyle = '#e0a92e';
    ctx.beginPath();
    ctx.ellipse(0, 7, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    [-1, 1].forEach((side) => {
      ctx.fillStyle = '#fff4e0';
      ctx.beginPath();
      ctx.arc(side * 5, 18, 1.6, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.strokeStyle = '#c08f2a';
    ctx.lineWidth = 1.2;
    [-12, 12].forEach((x) => {
      ctx.beginPath();
      ctx.moveTo(x - 5, 30);
      ctx.lineTo(x + 5, 30);
      ctx.stroke();
    });

    ctx.fillStyle = '#dff2ff';
    ctx.strokeStyle = '#5b7f8e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(13, 13, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawStarlight() {
    ctx.save();
    ctx.lineJoin = 'round';
    [-14, 14].forEach((x) => {
      ctx.fillStyle = '#ffd36a';
      ctx.strokeStyle = '#8a6a1e';
      ctx.lineWidth = 1.4;
      roundRect(x - 8, 44, 16, 10, 5);
      ctx.fill();
      ctx.stroke();
    });

    ctx.beginPath();
    ctx.moveTo(-13, 6);
    ctx.quadraticCurveTo(-24, 15, -30, 44);
    ctx.lineTo(30, 44);
    ctx.quadraticCurveTo(24, 15, 13, 6);
    ctx.closePath();
    ctx.fillStyle = '#2b2350';
    ctx.strokeStyle = '#17122f';
    ctx.lineWidth = 1.8;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-10, 22);
    ctx.quadraticCurveTo(-18, 32, -22, 42);
    ctx.lineTo(22, 42);
    ctx.quadraticCurveTo(18, 32, 10, 22);
    ctx.closePath();
    ctx.fillStyle = 'rgba(122, 104, 190, 0.45)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-11, 7);
    ctx.quadraticCurveTo(-14, 16, -10, 23);
    ctx.quadraticCurveTo(0, 27, 10, 23);
    ctx.quadraticCurveTo(14, 16, 11, 7);
    ctx.closePath();
    ctx.fillStyle = '#4a3d86';
    ctx.fill();
    ctx.stroke();

    drawSparkle(-14, 30, 3.2, '#ffd36a', 0.95);
    drawSparkle(12, 36, 2.5, '#ffd36a', 0.9);
    drawSparkle(4, 27, 1.8, '#fff4e0', 0.8);
    drawSparkle(-3, 37, 1.6, '#ffd36a', 0.75);

    ctx.fillStyle = '#ffd36a';
    roundRect(-11, 20, 22, 3, 1.5);
    ctx.fill();
    ctx.restore();
  }

  function drawOutfit(look) {
    if (look.outfit === 'cozy') {
      drawCozy();
      return;
    }
    if (look.outfit === 'sleepover') {
      drawSleepover();
      return;
    }
    if (look.outfit === 'rainy') {
      drawRainy();
      return;
    }
    if (look.outfit === 'starlight') {
      drawStarlight();
      return;
    }
    drawPrincessDress();
    drawPrincessShoes();
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

  function drawHeart(x, y, size, alpha, color = '#ff7b93') {
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

  function drawEffects(now, state, centerX, centerY) {
    if (state === 'idle') {
      const pulse = 0.26 + 0.16 * Math.sin(now / 900);
      drawSparkle(centerX - 55, centerY - 40, 4, '#ffb3dc', pulse);
      drawSparkle(centerX + 57, centerY - 32, 3, '#fff0b8', pulse * 0.9);
      drawHeart(centerX + 63, centerY - 47, 3.8, 0.2 + 0.12 * Math.sin(now / 700));
    }

    if (state === 'wave') {
      drawSparkle(centerX + 55, centerY + 4, 3.2, '#ffd36a', 0.45 + 0.2 * Math.sin(now / 130));
    }

    if (state === 'wake') {
      drawSparkle(centerX - 48, centerY - 28, 3.6, '#ffe5a5', 0.75);
      drawSparkle(centerX + 48, centerY - 28, 3.6, '#ffb3dc', 0.75);
    }

    if (state === 'sleepy') {
      ctx.save();
      ctx.fillStyle = '#8f5f80';
      const drift = (now / 2200) % 1;
      for (let i = 0; i < 3; i += 1) {
        const progress = (drift + i * 0.32) % 1;
        ctx.globalAlpha = (1 - progress) * 0.65;
        ctx.font = `700 ${9 + progress * 5}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillText('z', centerX + 46 + progress * 13, centerY - 40 - progress * 28);
      }
      ctx.restore();
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

  function hobbyPhase(now, hobby) {
    if (!hobby) return 0;
    const duration = Math.max(1, hobby.endsAt - hobby.startedAt);
    return Math.min(1, Math.max(0, (now - hobby.startedAt) / duration));
  }

  function coffeeLiftAt(now, hobby) {
    if (!hobby) return 0;
    const t = ((now - hobby.startedAt) % 6000 + 6000) % 6000;
    if (t < 3600 || t > 4800) return 0;
    return Math.sin(((t - 3600) / 1200) * Math.PI);
  }

  function drawHobbyProp(now, hobby) {
    if (!hobby) return;
    const fade = Math.min(1, Math.max(0, (now - hobby.startedAt) / 250));
    ctx.save();
    ctx.globalAlpha = fade;
    if (hobby.id === 'reading') {
      ctx.save();
      ctx.translate(0, 38);
      ctx.rotate(-0.03);
      ctx.fillStyle = '#8f5fbf';
      ctx.strokeStyle = MASCOT.outline;
      ctx.lineWidth = 1.4;
      roundRect(-27, -11, 54, 22, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff8ea';
      ctx.strokeStyle = MASCOT.creamDeep;
      ctx.lineWidth = 0.8;
      roundRect(-24, -9, 48, 18, 3);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(0, 9);
      ctx.strokeStyle = MASCOT.creamDeep;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(122, 37, 86, 0.3)';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        ctx.moveTo(-20, -4 + i * 4);
        ctx.lineTo(-7, -4 + i * 4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(7, -4 + i * 4);
        ctx.lineTo(20, -4 + i * 4);
        ctx.stroke();
      }
      const flip = (now % 4500) / 4500;
      if (flip > 0.85) {
        const turn = (flip - 0.85) / 0.15;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.quadraticCurveTo(9 + turn * 9, -2, 0, 9);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = MASCOT.pinkDeep;
      ctx.fillRect(-2, -13, 4, 12);
      ctx.restore();
    } else if (hobby.id === 'coffee') {
      const lift = coffeeLiftAt(now, hobby);
      ctx.save();
      ctx.translate(24, 31 - lift * 7);
      ctx.fillStyle = '#d98b5f';
      ctx.strokeStyle = MASCOT.outline;
      ctx.lineWidth = 1.5;
      roundRect(-8, -7, 16, 14, 4);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(9, 0, 4.5, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      drawJewelHeart(0, 0, 2.8, '#fff4e0', MASCOT.goldDeep);
      ctx.strokeStyle = 'rgba(122, 74, 56, 0.55)';
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i += 1) {
        const sway = Math.sin(now / 420 + i) * 2;
        ctx.beginPath();
        ctx.moveTo(-4 + i * 4, -11);
        ctx.quadraticCurveTo(-6 + i * 4 + sway, -17, -3 + i * 4 + sway, -24);
        ctx.stroke();
      }
      ctx.restore();
    } else if (hobby.id === 'stretch') {
      const lift = Math.sin(hobbyPhase(now, hobby) * Math.PI);
      drawSparkle(-38, 12 - lift * 4, 3.6, MASCOT.gold, 0.8);
      drawSparkle(38, 12 - lift * 4, 3.6, MASCOT.pink, 0.75);
    }
    ctx.restore();
  }

  function drawPet(now, state, hobby) {
    const palette = currentPalette();
    const sprite = snapshot && snapshot.pet && snapshot.pet.sprite;
    const width = viewportWidth;
    const height = viewportHeight;
    const baseY = viewportBaseY ?? height - 40;
    const hobbyId = hobby && hobby.id;
    const bobTable = {
      idle: Math.sin(now / 1100) * 2,
      thinking: Math.sin(now / 700) * 3,
      working: Math.abs(Math.sin(now / 130)) * 5,
      'needs-you': Math.abs(Math.sin(now / 260)) * 15,
      done: Math.abs(Math.sin(now / 200)) * 9,
      error: 0,
      pet: Math.sin(now / 180) * 4,
      wave: Math.sin(now / 180) * 2,
      sleepy: Math.sin(now / 1600) * 2,
      wake: Math.abs(Math.sin(now / 110)) * 2.5,
      offline: Math.sin(now / 1800) * 1,
    };
    const bob = bobTable[state] || 0;
    const shake = state === 'error' ? Math.sin(now / 38) * 3 : 0;
    const centerX = width / 2 + shake;
    const centerY = baseY - 48 * PET_SCALE - bob;
    const tilt = state === 'thinking' ? -0.07 : hobbyId === 'reading' ? 0.02 : 0;
    const stretchScale = hobbyId === 'stretch' ? Math.sin(hobbyPhase(now, hobby) * Math.PI) * 0.025 : 0;

    drawShadow(width / 2, baseY, bob);

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(tilt);
    const squash = 1 + Math.sin(now / 320) * 0.015 + stretchScale;
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
      drawPixelFace(now, state, centerX, centerY, hobby);
      drawGlasses();
      drawHat();
      if (wardrobe.outfit === 'princess') drawTiara();
      drawWardrobeBow();
      drawOutfit(wardrobe);
      drawHobbyProp(now, hobby);
      if (state !== 'working') drawHands(now, state, hobby);
      if (state === 'working') drawKeyboard(now, palette.hue);
    }
    ctx.restore();

    drawEffects(now, state, centerX, centerY);
  }


  function draw(context, options = {}) {
    applyLook(options.look);
    ctx = context;
    cursorLocal = options.cursor || null;
    wakeAt = Number.isFinite(options.wakeAt) ? options.wakeAt : 0;
    viewportWidth = Number.isFinite(options.width) ? options.width : 300;
    viewportHeight = Number.isFinite(options.height) ? options.height : 330;
    viewportBaseY = Number.isFinite(options.baseY) ? options.baseY : null;
    PET_SCALE = Number.isFinite(options.scale) ? options.scale : 1.2;
    customImage = options.customImage || null;
    snapshot = customImage ? { pet: { sprite: { type: 'image' } } } : null;
    drawPet(options.now || 0, options.state || 'idle', options.hobby || null);
  }

  function colors(look) {
    applyLook(look);
    return { ...MASCOT };
  }

  function paletteFor(themeId) {
    const theme = THEMES[themeId] || THEMES.rose;
    return { hue: theme.hue, hue2: theme.hue2 };
  }

  const BuffyCharacter = {
    PET_SCALE,
    OUTFITS: ['princess', 'cozy', 'sleepover', 'rainy', 'starlight'],
    BOWS: ['none', 'pink', 'lavender', 'mint', 'gold'],
    HATS: ['none', 'beret', 'party', 'sunhat'],
    GLASSES: ['none', 'round', 'heart', 'star'],
    WANDS: ['none', 'star', 'heart'],
    HOBBIES: ['reading', 'coffee', 'stretch'],
    supports(slot, id) {
      const lists = {
        outfit: this.OUTFITS,
        bow: this.BOWS,
        hat: this.HATS,
        glasses: this.GLASSES,
        wand: this.WANDS,
        theme: Object.keys(THEMES),
      };
      return Array.isArray(lists[slot]) && lists[slot].includes(id);
    },
    draw,
    colors,
    paletteFor,
    drawHeart,
    drawSparkle,
  };

  globalThis.BuffyCharacter = BuffyCharacter;
})();
