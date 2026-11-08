/* global globalThis */
(function manifestModule(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BUFFY_MANIFEST = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildManifest() {
  'use strict';

  const POSES = [
    'idle',
    'typingLeft',
    'typingRight',
    'happy',
    'wave',
    'sleepy',
    'reading',
    'tea',
    'gardening',
  ];

  const buffyPoseFiles = {};
  for (const pose of POSES) buffyPoseFiles[pose] = `buffy/poses/${pose}.svg`;

  const buffyOutfits = {
    dress: 'buffy/outfits/dress.svg',
    cozy: 'buffy/outfits/cozy.svg',
    rainy: 'buffy/outfits/rainy.svg',
    starlight: 'buffy/outfits/starlight.svg',
    overalls: 'buffy/outfits/overalls.svg',
  };

  const buffyAccessories = {
    bow: {
      pink: 'buffy/accessories/bow-pink.svg',
      lavender: 'buffy/accessories/bow-lavender.svg',
      mint: 'buffy/accessories/bow-mint.svg',
      gold: 'buffy/accessories/bow-gold.svg',
    },
    hat: {
      beret: 'buffy/accessories/hat-beret.svg',
      party: 'buffy/accessories/hat-party.svg',
      sunhat: 'buffy/accessories/hat-sunhat.svg',
    },
    glasses: {
      round: 'buffy/accessories/glasses-round.svg',
      heart: 'buffy/accessories/glasses-heart.svg',
      star: 'buffy/accessories/glasses-star.svg',
    },
    wand: {
      star: 'buffy/accessories/wand-star.svg',
      heart: 'buffy/accessories/wand-heart.svg',
    },
  };

  return {
    version: 1,
    poses: POSES,
    characters: [
      {
        id: 'buffy',
        name: 'Buffy',
        tagline: 'A plush storm-cloud who keeps you company while you build.',
        renderer: 'layered',
        size: { width: 512, height: 640 },
        base: 'buffy/base.svg',
        poses: buffyPoseFiles,
        compactCrop: { x: 56, y: 62, width: 400, height: 400 },
        face: { x: 256, y: 308, width: 176, height: 112 },
        outfits: ['none', 'dress', 'cozy', 'rainy', 'starlight', 'overalls'],
        outfitAssets: buffyOutfits,
        accessories: {
          bow: ['none', 'pink', 'lavender', 'mint', 'gold'],
          hat: ['none', 'beret', 'party', 'sunhat'],
          glasses: ['none', 'round', 'heart', 'star'],
          wand: ['none', 'star', 'heart'],
        },
        accessoryAssets: buffyAccessories,
        themes: ['plum', 'rose', 'lavender', 'mint', 'sky', 'butter', 'midnight'],
        defaultLook: {
          outfit: 'dress',
          bow: 'pink',
          hat: 'none',
          glasses: 'none',
          wand: 'none',
          theme: 'plum',
        },
        supportedPoses: POSES,
      },
      {
        id: 'mochi',
        name: 'Mochi',
        tagline: 'A pocket bunny with nine hand-drawn moods.',
        renderer: 'atlas',
        atlas: 'mochi/poses.svg',
        cell: { width: 256, height: 320 },
        columns: 3,
        rows: 3,
        order: POSES,
        compactCell: { x: 0, y: 0, width: 256, height: 210 },
        accessories: {
          bow: ['none', 'pink'],
          hat: ['none'],
          glasses: ['none'],
          wand: ['none'],
        },
        accessoryAssets: {
          bow: { pink: 'mochi/bow.svg' },
        },
        outfits: ['none'],
        themes: ['rose', 'plum', 'lavender', 'butter'],
        defaultLook: {
          outfit: 'none',
          bow: 'none',
          hat: 'none',
          glasses: 'none',
          wand: 'none',
          theme: 'rose',
        },
        supportedPoses: POSES,
      },
    ],
  };
});
