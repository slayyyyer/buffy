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

  // Buffy's layered renderer can express reactions that need new art. Atlas
  // companions stay at the original nine cells and map these to nearest poses.
  const REACTION_POSES = ['flustered', 'tapping', 'squish', 'waiting', 'celebrate'];
  const BUFFY_POSES = [...POSES, ...REACTION_POSES];

  const buffyPoseFiles = {};
  for (const pose of BUFFY_POSES) buffyPoseFiles[pose] = `buffy/poses/${pose}.svg`;

  const buffyOutfits = {
    dress: 'buffy/outfits/dress.svg',
    cozy: 'buffy/outfits/cozy.svg',
    hoodie: 'buffy/outfits/hoodie.svg',
    pinafore: 'buffy/outfits/pinafore.svg',
    pajamas: 'buffy/outfits/pajamas.svg',
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
    reactionPoses: REACTION_POSES,
    characters: [
      {
        id: 'buffy',
        name: 'Buffy',
        tagline: 'A plush storm-cloud who keeps you company while you build.',
        shortTagline: 'Your plush storm-cloud.',
        renderer: 'layered',
        size: { width: 512, height: 640 },
        base: 'buffy/base.svg',
        poses: buffyPoseFiles,
        compactCrop: { x: 56, y: 62, width: 400, height: 400 },
        face: { x: 256, y: 308, width: 192, height: 120 },
        outfits: ['none', 'dress', 'cozy', 'hoodie', 'pinafore', 'pajamas', 'rainy', 'starlight', 'overalls'],
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
        supportedPoses: BUFFY_POSES,
      },
      {
        id: 'mochi',
        name: 'Mochi',
        tagline: 'A pocket bunny with nine hand-drawn moods.',
        shortTagline: 'A pocket bunny.',
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
      {
        id: 'pip',
        name: 'Pip',
        tagline: 'A pocket comet fox with a star-tipped tail.',
        shortTagline: 'A comet fox with a star tail.',
        renderer: 'atlas',
        atlas: 'pip/poses.svg',
        cell: { width: 256, height: 320 },
        columns: 3,
        rows: 3,
        order: POSES,
        compactCell: { x: 0, y: 0, width: 256, height: 210 },
        accessories: {
          bow: ['none', 'gold'],
          hat: ['none', 'beret'],
          glasses: ['none', 'star'],
          wand: ['none', 'heart'],
        },
        accessoryAssets: {
          bow: { gold: 'pip/accessories/bow-gold.svg' },
          hat: { beret: 'pip/accessories/hat-beret.svg' },
          glasses: { star: 'pip/accessories/glasses-star.svg' },
          wand: { heart: 'pip/accessories/wand-heart.svg' },
        },
        outfits: ['none', 'comet', 'stargazer'],
        outfitAssets: {
          comet: 'pip/outfits/comet.svg',
          stargazer: 'pip/outfits/stargazer.svg',
        },
        themes: ['butter', 'rose', 'plum', 'mint', 'sky'],
        defaultLook: {
          outfit: 'none',
          bow: 'none',
          hat: 'none',
          glasses: 'none',
          wand: 'none',
          theme: 'butter',
        },
        supportedPoses: POSES,
      },
      {
        id: 'mallow',
        name: 'Mallow',
        tagline: 'A mint marshmallow bear with a sleepy streak.',
        shortTagline: 'A mint marshmallow bear.',
        renderer: 'atlas',
        atlas: 'mallow/poses.svg',
        cell: { width: 256, height: 320 },
        columns: 3,
        rows: 3,
        order: POSES,
        compactCell: { x: 0, y: 0, width: 256, height: 210 },
        accessories: {
          bow: ['none', 'lavender'],
          hat: ['none', 'sunhat'],
          glasses: ['none', 'round'],
          wand: ['none', 'star'],
        },
        accessoryAssets: {
          bow: { lavender: 'mallow/accessories/bow-lavender.svg' },
          hat: { sunhat: 'mallow/accessories/hat-sunhat.svg' },
          glasses: { round: 'mallow/accessories/glasses-round.svg' },
          wand: { star: 'mallow/accessories/wand-star.svg' },
        },
        outfits: ['none', 'marshmallow', 'moonlight'],
        outfitAssets: {
          marshmallow: 'mallow/outfits/marshmallow.svg',
          moonlight: 'mallow/outfits/moonlight.svg',
        },
        themes: ['mint', 'lavender', 'rose', 'sky'],
        defaultLook: {
          outfit: 'none',
          bow: 'none',
          hat: 'none',
          glasses: 'none',
          wand: 'none',
          theme: 'mint',
        },
        supportedPoses: POSES,
      },
    ],
  };
});
