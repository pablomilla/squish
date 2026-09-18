# Squish artwork set

## Start here

- `svg/squish-master.svg` — full-body excited/default character.
- `svg/squish-wordmark.svg` — custom lettering traced directly from the approved board.
- `svg/squish-lockup.svg` — character and wordmark together.
- `squish-moods-preview.png` — all seven vector renders.
- `svg/moods/` — excited, nomnom, calm, sleepy, proud, cheering, thinking.
- `svg/dark/` — matching shapes with the brief's dark skin palette.
- `svg/flat/` — matching shapes with flat fills, no gradients.
- `png/moods/` — transparent 1024 × 1024 renders of the light SVGs.
- `public/` — browser/PWA icon assets.
- `store/` — icon and feature-graphic exports at the sizes in the brief.
- `reference/` — six enlarged reference crops and the approved thinking image. These are review references, not vector outputs.

## Visual fidelity and source

The six original poses follow the supplied brand-board designs. Their dark face contours were traced directly from the reference pixels. The thinking pose follows the approved generated concept. All character bodies, arms, props and gradient shading have been reconstructed as editable vectors; these are not pixel-identical copies of the raster references. The reference's surface texture and fine soft shading are approximated with simple gradients. The PNGs in `png/moods/` are renders of the SVGs, not the original generated image.

The wordmark uses traced letter silhouettes and the original heart placement, not substituted Fredoka text. Its interior shading is recreated with simple gradients. The original generated brand-board text is already artwork; there is no live type in the SVG.

Preserving the board's poses required separate body/arm geometry across moods (especially sleepy and thinking), rather than forcing all faces onto one identical body silhouette. Every mood uses a shared 512 × 512 viewBox and the same layer interface. This follows the user's board-fidelity priority over the brief's single-body suggestion.

## Layer interface

Each standalone mood has:

```
shadow
body
feet
  foot-left
  foot-right
face
  eyes
  mouth
  blush
props
arms
  arm-left
  arm-right
accents
```

Arms are groups so their colour and shading move together. The skin lighting and contact shading are separate editable paths. Blinking should animate/replace the `eyes` group; a face has the mood identifier in its `data-mood` attribute. The `props` group holds the leaf, watermelon or heart as appropriate. Sleep marks and celebration sparks are outlined paths in `accents`.

Use each complete pose when matching the board; replacing just a face on another body will produce a different pose. Keep transformations local to the character group for bobbing, and respect reduced-motion preferences. Importing via `<img>` preserves rendering but does not expose inner layers to animation. Inline SVG or a component conversion is needed for per-layer animation.

If mounting multiple SVGs inline, prefix every ID and matching `url(#...)` reference with a unique instance identifier. Standalone SVG documents can keep the named layer IDs as delivered. Do not globally replace every fill with currentColor; that removes the intentional skin, blush and prop colours.

## Colour

Skin tokens use the brief:
- Light: #FFFAF4 / #FDEADC / #F6D7C4
- Dark: #FDF3EA / #F4DDCC / #E2BFA9
- Ink: #2B2340
- Blush: #F4899F
- Sparks: #F2C84B

Gradient stops add intermediate/shading colours for dimensionality. The app-icon lavender (#C9BEFF) follows the board; the brief's main purple (#6B5FE0) remains an interface colour. The exact traced wordmark's ink/pink are sampled approximations of the board rather than globally forced to the UI tokens.

## Public icons

- squish-icon.svg — square 512 viewBox
- apple-touch-icon.png — 180 × 180 RGB PNG
- icon-192.png — 192 × 192 RGB PNG
- icon-512.png — 512 × 512 RGB PNG
- icon-maskable-512.png — 512 × 512 RGB PNG, conservative centred artwork
- favicon.ico — 32 × 32 PNG-backed ICO

All backgrounds run to the full square edges. No icon has pre-rounded corners. The maskable artwork is smaller than the standard icon to preserve its extremities under circular cropping. `squish-icon-maskable.svg` is included as an editable source.

To resolve the icon issue identified in the brief, the application still needs to reference the provided PNG from its `apple-touch-icon` link and register the PNGs with the appropriate sizes and maskable purpose in its manifest. This delivery does not edit the application or claim that the live bug is fixed.

## Store exports

Includes a 1024 × 1024 RGB Apple icon with no alpha, 512 × 512 RGBA Google Play icon, 1024 × 500 RGB feature graphic, and a transparent 432 × 432 adaptive foreground. Adaptive background: #C9BEFF. Store requirements should be checked at submission; these exports follow the supplied brief, not a new review of current store rules.

Actual app screenshots, preview videos and share-card integration are outside this artwork package. Screenshots should be captured from the implemented app, as the brief specifies.

## Validation

All 28 SVGs were parsed and rasterized successfully. Every SVG has a viewBox and no fixed root width/height. None contains embedded images, text elements, fonts, scripts, filters or foreignObject. IDs are unique inside each document and all gradient/clip references resolve. Mood files have 19–29 paths. Strict flat versions have no gradients. See validation.json and raster-validation.json for file-level checks.
