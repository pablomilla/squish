# Squish Extras — Phase 1 artwork handoff

Created from the Phase 1 scope in Squish Extras Brief, version 1, 24 September 2026. This delivery contains the measured anchor sheet, twelve launch accessories and six home scenes in light and dark. Share frames, stickers, streak badges and Winter/other seasonal kits belong to Phase 2 and are not included. Native widgets remain Phase 3, after the apps exist. This is an artwork handoff, not an app integration or commercial quotation.

## Character fidelity

The seven character SVGs embedded in the supplied brief were reused. Their path geometry was preserved; their cropped display viewBox was restored to 0 0 512 512, CSS colour variables resolved to their supplied fallback colours, and CSS classes removed. Accessories are separate editable vectors. This preserves the supplied vector character; it does not claim a pixel-identical reproduction of the original shaded raster brand board.

## Contents

- anchors.json: measured head, eye and neck attachment coordinates, plus measurement method.
- anchors/: seven annotated vector anchor sheets; labels converted to outlines.
- accessories/{slot}/{item}/: canonical excited-pose back.svg/front.svg, metadata, seven fitted pairs, seven composite SVG previews, contact sheet and transparent 1536px PNG layers.
- scenes/: kitchen, picnic, beach, stars, space and rainy-window, each with light/dark SVGs, full PNGs and smaller-card crop proofs.
- fitting-proof.png: first three accessories across all seven poses.
- accessories-overview.png and scenes-overview.png: visual catalogues.
- size-theme-proof.png: all twelve accessories at 58, 92 and 132px on both theme backgrounds. Rows: beanie, chef hat, crown, earmuffs, headphones, party hat, sweatband, heart shades, round specs, knit scarf, medal, neckerchief.
- validation.json: structural validation results.

## Integration

Use the fitted/{pose}-back.svg and fitted/{pose}-front.svg files directly on a shared 512 square canvas. They already contain placement, scale and rotation: do not apply anchors a second time. Their PNG equivalents are under png/fitted/. Canonical back.svg/front.svg are already placed for excited. When composing inline SVGs, prefix IDs and their URL references per instance to avoid collisions across instances.

For dynamic fitting, use the target anchor versus excited: translate to the target anchor, rotate to its angle and scale by target width / excited width (eye spacing for face items). Undo the canonical placement before applying this transform. Neck tilt is 0.35 times eye-line tilt. Beanie and sweatband use a lower, eye-relative seat so their bottom edges sit just above the eyes; use their fitted files rather than a generic head-anchor transform. Sleepy and thinking scarf geometry has a dedicated adjustment; use its fitted/variant files rather than a generic transform.

Keep accessory back behind the character. Keep face/head fronts above the body and face. Keep arms above clothing. Neck fronts go before the watermelon/props: the brief's written requirement says the watermelon covers the scarf, although its layer diagram shows a different order. Composite previews demonstrate this choice.

The optional anim groups are complete still artwork. item.json describes suggested animation; no timed animation is implemented. Respect reduced motion.

Scene viewBox is 0 0 1344 690, for 448 × 230 logical pixels at 3×. The smaller card uses the bottom-right crop x=360, y=240, width=984, height=450, giving 328 × 150 logical pixels. Ground is at y=618. No character or app copy is baked into scenes. The quiet region remains clear after cropping. Contrast figures for the specified text colours against the quiet background appear in scene-manifest.json; all exceed 4.5:1.

## Verification and remaining checks

All 297 SVGs parse and have viewBoxes, unique IDs within each file, resolved gradient references, and no embedded raster, live text, CSS, filters or masks. Canonical layers are under 15KB and scenes under 60KB. Raster exports were rendered and fitting/theme previews inspected.

Fine knit/ribbing detail becomes decorative texture at 58px; silhouettes carry recognition. The preview uses the supplied cream character on both backgrounds. The actual twelve production skin/finish definitions and app test build were not supplied, so twelve-colourway acceptance, dark-skin integration, combined-item clipping, native renderer behaviour and animation/device testing remain app-team checks. These are not represented as completed tests.

All new extras were drawn as vector geometry; no image generation or stock artwork was used for this phase.
