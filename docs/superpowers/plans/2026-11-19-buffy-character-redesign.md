# Buffy Character Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw Buffy as a plush pink robot matching the user’s references across her body, expressions, animations, wardrobe, accessories, icons, and promotional art.

**Architecture:** Keep Buffy’s layered renderer and its 512×640 coordinate system. Redraw the existing SVG layers in place, update the face bounds and code-drawn fallback to match, and regenerate existing PNG brand and promo outputs from the new design without changing wardrobe behavior.

**Tech Stack:** SVG, Canvas 2D, existing PNG assets; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-19-buffy-character-redesign.md`

## Global Constraints

- Preserve Buffy’s existing SVG asset paths, 512×640 viewBox, manifest pose keys, wardrobe options, and theme options.
- Keep eyes and face screen readable at overlay and wardrobe preview sizes.
- Keep other companion art and wardrobe/settings UI unchanged.
- Add no dependencies.
- User asked for the art update, not test execution; use visual and asset integrity checks without adding or running tests.

## Review Focus

- **Layer alignment:** body, costume, pose limbs, face, and accessories must remain registered on the current 512×640 canvas; visually inspect the default look and representative combinations.
- **Small-size legibility:** the screen eyes, smile, and costume accents must remain distinct at compact and wardrobe sizes; inspect scaled previews.
- **Complete catalog coverage:** every current pose, outfit, and accessory must have updated art; compare against the manifest and catalog.
- **Theme and fallback consistency:** code-drawn fallback and themed variants must retain the new identity; inspect rose, lavender, and a contrasting theme.
- **Brand output consistency:** app and site icons and Buffy promo images must match the refreshed character; inspect the raster outputs.

## File Structure

- `overlay/characters/buffy/base.svg`: Buffy’s plush pink cloud body, ears, boots, and permanent details.
- `overlay/characters/buffy/poses/*.svg`: pose-specific arms, hands, props, and reactions, aligned to the base.
- `overlay/characters/buffy/outfits/*.svg`: all 19 current outfit layers, preserving names and draw bounds.
- `overlay/characters/buffy/accessories/*.svg`: all 12 bows, hats, glasses, and wands.
- `overlay/character.js`: palette and procedural fallback art for when layered character art is unavailable.
- `overlay/icon.png`, `build/icon.png`, `docs/icon.png`: existing app and site icons.
- `docs/buffy.png`, `docs/shots/buffy.png`, `README.md`, `docs/index.html`: Buffy-specific promo art and descriptive text.

## Tasks

### Task 1: Establish the new base and screen face

**Files:** `overlay/characters/buffy/base.svg`; `overlay/characters/manifest.js`; `overlay/character-system.js` only if existing face alignment requires a renderer adjustment.

- [ ] Redraw Buffy’s base as the reference’s scalloped pink plush robot, including round pink ear pieces, dark plum screen, small limbs, and bright boots; preserve transparent background and the 512×640 viewBox.
- [ ] Enlarge and reposition the expression bounds to center (256, 279) with a 224×136 face box, matching the new screen at x=144, y=211.
- [ ] Render the base at full size and compact crop size; inspect silhouette, registration, and readable face area.

### Task 2: Redraw every pose

**Files:** all 14 SVGs in `overlay/characters/buffy/poses/`.

- [ ] Redraw each pose’s limb positions and props to fit the new body, maintaining existing filenames and bounds.
- [ ] Check each pose against the base and the face area at full and compact sizes.

### Task 3: Redraw all outfits and accessories

**Files:** all 19 SVGs in `overlay/characters/buffy/outfits/`; all 12 SVGs in `overlay/characters/buffy/accessories/`.

- [ ] Redraw every outfit as a dimensional, cute garment layer that fits the new body; retain each outfit’s recognizable theme and color.
- [ ] Redraw bows, hats, glasses, and wands to match the reference’s polished plush and jewel-like finish; preserve placement and compatibility with outfits.
- [ ] Inspect the default princess look and representative casual, seasonal, and fantasy looks with accessory combinations.

### Task 4: Match the procedural fallback

**Files:** `overlay/character.js`.

- [ ] Update the fallback cloud body palette, rounded ear pieces, pixel-screen face details, and body styling to match the reference while preserving motion, expression, gaze, and wardrobe draw behavior.
- [ ] Inspect the default fallback and multiple existing theme palettes for consistent identity.

### Task 5: Refresh brand and promotional outputs

**Files:** `overlay/icon.png`, `build/icon.png`, `docs/icon.png`, `docs/buffy.png`, `docs/shots/buffy.png`, `README.md`, `docs/index.html`.

- [ ] Create icon and promo art from the redesigned character, retaining current output formats and dimensions.
- [ ] Replace Buffy-specific promo imagery where present and update alt text to describe the new appearance.
- [ ] Inspect icons at application sizes and promo images in their page contexts.

### Task 6: Review the full asset set

**Files:** all files above.

- [ ] Compare asset paths against `overlay/characters/manifest.js` and confirm every listed Buffy pose, outfit, and accessory remains present.
- [ ] Review all poses, all wardrobe looks, representative theme colors, compact rendering, and icon/promo outputs at their target sizes.
- [ ] Confirm there are no edits to unrelated companion assets, catalog identifiers, or user preferences.
