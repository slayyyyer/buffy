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

  const nimbusPoseFiles = {};
  for (const pose of POSES) nimbusPoseFiles[pose] = `nimbus/poses/${pose}.svg`;

  const nimbusOutfits = {
    dress: 'nimbus/outfits/dress.svg',
    cozy: 'nimbus/outfits/cozy.svg',
    rainy: 'nimbus/outfits/rainy.svg',
    starlight: 'nimbus/outfits/starlight.svg',
    overalls: 'nimbus/outfits/overalls.svg',
  };

  const nimbusAccessories = {
    bow: {
      pink: 'nimbus/accessories/bow-pink.svg',
      lavender: 'nimbus/accessories/bow-lavender.svg',
      mint: 'nimbus/accessories/bow-mint.svg',
      gold: 'nimbus/accessories/bow-gold.svg',
    },
    hat: {
      beret: 'nimbus/accessories/hat-beret.svg',
      party: 'nimbus/accessories/hat-party.svg',
      sunhat: 'nimbus/accessories/hat-sunhat.svg',
    },
    glasses: {
      round: 'nimbus/accessories/glasses-round.svg',
      heart: 'nimbus/accessories/glasses-heart.svg',
      star: 'nimbus/accessories/glasses-star.svg',
    },
    wand: {
      star: 'nimbus/accessories/wand-star.svg',
      heart: 'nimbus/accessories/wand-heart.svg',
    },
  };

  return {
    version: 1,
    poses: POSES,
    characters: [
      {
        id: 'nimbus',
        name: 'Nimbus',
        tagline: 'A plush storm-cloud who keeps you company while you build.',
        renderer: 'layered',
        size: { width: 512, height: 640 },
        base: 'nimbus/base.svg',
        poses: nimbusPoseFiles,
        compactCrop: { x: 56, y: 62, width: 400, height: 400 },
        face: { x: 256, y: 308, width: 176, height: 112 },
        outfits: ['none', 'dress', 'cozy', 'rainy', 'starlight', 'overalls'],
        outfitAssets: nimbusOutfits,
        accessories: {
          bow: ['none', 'pink', 'lavender', 'mint', 'gold'],
          hat: ['none', 'beret', 'party', 'sunhat'],
          glasses: ['none', 'round', 'heart', 'star'],
          wand: ['none', 'star', 'heart'],
        },
        accessoryAssets: nimbusAccessories,
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
