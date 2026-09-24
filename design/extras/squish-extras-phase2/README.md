# Squish Extras — Phase 2, launch share set + Winter 2026

This delivery starts Phase 2 with the launch share assets and the first seasonal kit requested in the brief. Later seasonal kits remain scheduled follow-on work; they are not included or automatically scheduled here. No app integration is included.

## Included

- Four share frames: scallop and confetti (earned), botanical and gold-foil (Plus).
- Twelve share stickers: strawberry, avocado, carrot, water glass, star, heart, sun and thumbs up (earned); rainbow, sparkles, “Go me!” and “Squished it!” (Plus).
- Four free earned streak badges: 7, 30, 100 and 365 days.
- Winter 2026: Santa hat AND reindeer antlers, each fitted to all seven existing poses; snowy village light/dark scene; snowflake share frame; mug, gingerbread and snowflake stickers.
- Five assembled sample share cards, visual catalogues, and 48px/96px sticker proofs.

Winter runs 1–31 December and returns annually. Its three stickers are free; accessory/scene/frame are Plus or seasonal pack items. People retain acquired items. Only one head accessory is worn at a time.

## File formats and placement

Frames: editable SVG with viewBox 0 0 1080 1350 and transparent 1080 × 1350 PNG. Place over the existing share card. All artwork is inside the outer 64px band or permitted 200px corner regions. A raster alpha check confirms zero pixels outside those regions.

Stickers and badges: editable 240 × 240 SVG plus transparent 720 × 720 PNG (3×). Stickers use soft white keylines. Place at up to 240px in the supplied sticker slots (x 60–300 or 780–1020, y 260–660). Small-size proof shows 48 and 96px. Fine decorative details simplify at 48px.

Winter accessories: 512-square canonical back.svg/front.svg on excited; fitted/{pose}-{back,front}.svg already positioned for each pose. Transparent canonical PNG layers are under png/; fitted PNG layers under png/fitted/, all 1536 square. Do not transform fitted layers again. Santa hat sits just above the eyes, following the revised beanie fitting preference. Antlers use the measured head anchor. Character geometry is reused from the supplied brief; no character redesign.

Snowy village: 1344 × 690 SVG and PNG in light and dark. Small-card PNG crops are 984 × 450, cropped from x=360,y=240. Ground y=618. Left quiet area remains clear. Scene manifest records text contrast. No mascot or copy is baked into scene assets.

When placing multiple inline SVGs, prefix IDs and gradient references per instance. Groups back/front/anim are supplied where applicable. Santa bobble movement is only a suggested optional 3s loop, not implemented animation. Still artwork is complete.

## Lettering and originality

All lettering in deliverable SVGs is outlined. Streak numbers use Fredoka Bold; “Go me!” uses Caveat. Both fonts are SIL Open Font License. Caveat source: https://github.com/google/fonts/tree/main/ofl/caveat . Existing Squish wordmark is reused only in composed proof cards. Preview-sheet captions are rasterized labels, not app assets.

New artwork was drawn as vector geometry, without stock imagery or image generation. Editable SVGs contain no embedded raster, live text, filters, masks, CSS classes or style blocks.

## Checks and limitations

See validation.json and frame-clearance-check.json. SVG structure, ID references and file-size budgets pass. Standalone items are under 15KB and scenes under 60KB; assembled proof cards are larger and are not runtime assets. Rendered catalogues, small stickers and all seven Winter accessory fittings were visually inspected.

Sample share-card statistics are illustrative, not user data. These proofs demonstrate placement rather than a proposed replacement for the app's fixed share-card layout. Native rendering, actual twelve-colourway testing, app integration and device acceptance remain pending.

## Later work

New Year, Valentine’s, Spring, Summer and Halloween kits follow on their brief dates. Monthly Plus drops, the stretch Christmas jumper and Phase 3 widgets are outside this delivery.
