# Buffy character redesign

## Intent

Redesign Buffy to match the supplied pink plush robot reference: a soft scalloped cloud silhouette, vivid pink shell, dark rounded screen face, bright expressive eyes, and detailed feminine dress-up looks. The wardrobe screenshots show the desired variety and finish. Text and controls visible inside the screenshots are visual context, not product instructions.

## Goals

- Give Buffy a recognizable plush pink robot identity at overlay and wardrobe preview sizes.
- Carry the same lighting, materials, outline weight, and detail language through all Buffy poses, outfits, and accessories.
- Refresh Buffy-specific icons and promotional images so they represent the redesigned character.
- Preserve Buffy’s identity, animation behaviors, wardrobe options, file paths, and manifest interface.

## Non-goals

- Redesign other companion characters or the wardrobe/settings interface.
- Change character behavior, pose names, outfit choices, or wardrobe data.

## Approaches

- **Rebuild the Buffy art family (chosen):** establish a new shared plush-robot base and redraw every Buffy pose, outfit, and accessory to match it. This best matches the reference and avoids mixing the current flat vector style with the new look.
- **Retouch the current art:** recolor and add highlights while preserving the existing character silhouette. This is less disruptive but would not make Buffy look like the supplied reference.

## Design direction

Use the final supplied reference as the character anchor: a large scalloped pink plush head above a small dressed body, round pink ear pieces, a dark plum display face, large luminous eyes, a small smile, and hot-pink boots. Treat the prince and wardrobe examples as outfit references: rich fabrics, bows, heart and star accents, layered skirts, and varied colors while retaining a distinctly cute, feminine wardrobe. Keep facial features readable at small sizes and avoid fine texture that disappears in animation.

## Scope and constraints

Redraw the 46 files under `overlay/characters/buffy/` while preserving their existing paths and SVG format. Resize and reposition the screen and matching face expression bounds to suit the larger plush head. Update the procedural fallback character in `overlay/character.js` to match the new plush pink design. Refresh Buffy’s app and documentation icon artwork and Buffy-specific promotional images. Keep the pose keys, wardrobe API, and theme selections stable. No new dependencies or raster-only runtime requirement.

## Builder decisions

The implementation may choose exact gradients, layer geometry, and per-pose details, provided all assets read as one coherent character and remain legible at their existing display sizes.
