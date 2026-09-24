# Squish — complete seasonal artwork collection

Five new kits have been created: New Year, Valentine’s, Spring, Summer and Halloween. The existing Winter 2026 kit is included unchanged so the download contains all six seasons.

## Collection

| Kit | Recurring window | Accessory | Scene | Frame | Free stickers |
| --- | --- | --- | --- | --- | --- |
| Winter | 1–31 Dec | Santa hat and reindeer antlers | Snowy village | Snowflake | Mug, gingerbread, snowflake |
| New Year | 26 Dec–7 Jan | Glitter glasses | Fireworks city | Starburst | Party popper, midnight clock, “New me? Same me!” |
| Valentine’s | 1–14 Feb | Heart antennae | Sweet shop | Hearts | Love letter, strawberry heart, “You’re a treat” |
| Spring | 20 Mar–30 Apr | Bunny ears | Blossom garden | Blossom | Chick, tulip, egg |
| Summer | 21 Jun–31 Aug | Straw sun hat | Ice-lolly stand | Citrus | Ice lolly, watermelon slice, sunglasses |
| Halloween | 15–31 Oct | Pumpkin hat | Pumpkin patch | Bats | Friendly ghost, pumpkin, sweets |

The folder years identify the first release cycle: Winter December 2026, New Year December 2026–January 2027, and the remaining kits in 2027. Designs and availability windows recur annually. Acquired items remain owned after the window closes. All seasonal stickers are free; accessories, scenes and frames are Plus or the corresponding seasonal pack. Halloween is friendly, with no frightening imagery.

## Deliverables and use

There are seven accessories in total (Winter has two), six scenes with both light and dark versions, six frames and eighteen stickers. Accessories are fitted to all seven existing Squish poses. Use one accessory per slot; Winter’s head options are alternatives.

Accessories: back.svg/front.svg are canonical excited-pose layers in a 512-square viewBox. fitted/{pose}-{back,front}.svg contains final placement for each pose. Use fitted files directly without applying anchor transforms a second time. png/ and png/fitted/ contain transparent 1536-square exports. previews/ contains assembled SVGs; preview.png shows all seven poses. Head items retain head width/tilt, while glasses follow measured eye centres. The sun hat and pumpkin hat are seated relative to the eyes. anchors.json is included for reference.

Scenes: light.svg and dark.svg use viewBox 0 0 1344 690, with full-size PNGs and 984 × 450 bottom-right crop PNGs. Crop x=360,y=240; ground y=618. The left quiet region is reserved for copy. Each scene manifest reports contrast for the specified text colour; all exceed 4.5:1. No character or text is baked into the scene assets.

Frames: 1080 × 1350 editable SVG and same-size transparent PNG, with artwork confined to the outer 64px band or permitted 200px corner areas. Raster alpha clearance checks pass for all five new frames.

Stickers: 240-square SVG with soft white keylines, plus transparent 720-square PNG (3×). Use at 48–96px in-app and up to 240px on cards. New handwritten phrases use Caveat, converted to outlines. Fine decorative detail simplifies at small sizes.

Inline SVGs need IDs and gradient references prefixed per instance when combined. No new timed animations are implemented; the still artwork is complete. The existing Winter Santa bobble retains its optional animation note.

## Review files

- seasonal-overview.png: five new kits together.
- accessories-overview.png, stickers-overview.png, scenes-overview.png, frames-overview.png: component catalogues.
- sticker-size-proof.png: 48px and 96px stickers on light and dark backgrounds, in the collection order above excluding Winter.
- home-scenes-proof.png: bottom-right crop and character placement in both themes.
- share-cards-overview.png: composed sample share cards.
- Each new kit’s proofs/ folder: editable share-card and Home fitting proofs plus PNGs.

Proof cards use illustrative statistics, not real user data. Home fitting proofs omit app copy to show placement, and use the existing cream character on both backgrounds. They are not app screenshots or a proposed replacement for the app’s layout.

## Verification

All 212 SVGs parse and contain no embedded bitmaps, live text, filters, masks, style blocks or CSS classes. IDs are unique within each file and gradient references resolve. Standalone items are below 15KB and scenes below 60KB; composed proofs/previews are exempt. See validation.json and frame-clearance-check.json.

All new accessory pose sheets, scene crops and small-size sticker sheets were visually inspected. Existing character path geometry was reused. New artwork was drawn as editable vector geometry without stock images or image generation. Caveat and Fredoka are SIL Open Font License fonts; font outlines are embedded as paths. Caveat source: https://github.com/google/fonts/tree/main/ofl/caveat .

In-app integration, all twelve production character colourways, native renderer/device checks and optional animation implementation remain pending. These assets have not been deployed. Monthly Plus drops, the stretch Christmas jumper and native widgets are outside the seasonal-kit scope.
