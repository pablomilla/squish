# Squish Squad set — section 9, brief version 1.1

Three referral rewards, earned only and never purchasable: squad-cap, squad share frame and squad-badge. Eligibility and qualifying-friend rules remain owned by the app; no extra threshold is invented here.

## Cap

accessories/head/squad-cap/back.svg and front.svg are canonical excited-pose layers on a 512-square canvas. fitted/ contains back/front SVG pairs for all seven poses, already positioned. png/ and png/fitted/ contain transparent 1536-square PNG layers for widget composition. preview.png shows all poses. The cap uses a soft lavender crown, a small pink heart, a left-facing brim and a seven-degree jaunty tilt. The seat follows the eye line so the eyes remain readable. Use the fitted files directly; do not apply anchors twice. Existing arms remain above the cap front in the usual pose layering.

## Frame

share/frames/squad.svg and squad.png are 1080 × 1350, transparent. Small hearts run around the outer 64px band. Two copies of the existing proud Squish pose occupy the upper corner areas, with the right one mirrored so the raised arms wave towards one another. Character geometry is reused, not redrawn. Internal SVG use references keep the file small; there are no external dependencies. All artwork passes the permitted band/corner alpha check.

## Badge and unlocked moment

share/stickers/squad-badge.svg is the complete still badge: 240-square editable artwork with Fredoka Bold outlined lettering. PNGs are supplied at 240 and 720 square. It was inspected at 48 and 96px against both theme backgrounds.

share/stickers/squad-badge-unlock.svg is the optional one-second confetti burst. Its separate anim group contains the celebration; base badge geometry remains still. It plays once, fades out and never loops. Trigger on a newly awarded reward, not every time an achievements row renders. Use the still file whenever reduced motion is enabled. unlock-preview.html provides an explicit replay control and honours the browser's reduced-motion preference.

The animation uses SVG animate/animateTransform for browser preview. Native renderers that do not support those elements should recreate the anim group's translation/opacity keyframes using their native animation system. Duration 1000ms; translation key times 0%, 60%, 100%; opacity key times 0%, 15%, 70%, 100% with values 0,1,1,0. Each piece starts at badge centre, moves outward, then drifts 12px down as it fades. The SVG carries each piece's exact destination. The still version's confetti is decorative and optional; the badge also stands alone without it.

## Review and verification

squad-overview.png shows the three items on an illustrative share card. size-theme-proof.png shows the cap at 58/92/132/430px and badge at 48/96px. proofs/share-card.svg and PNG show card placement with sample figures. unlock-filmstrip.png samples the celebration at 0, 150, 600 and 1000ms.

All 31 SVGs parse, have unique IDs and resolved internal references, and contain no live text, embedded raster, CSS, masks or filters. Standalone items are below 15KB. Frame clearance passed with zero pixels outside allowed regions. The seven cap fits, small badge and unlock keyframes were visually inspected. Browser animation playback was not automatically exercised; native animation, app integration, twelve production colourways and device acceptance remain pending.

The two-theme proof uses the supplied cream character on each background. No other body colourways were invented. New assets were drawn as vector geometry, without stock art or image generation. Fredoka is used under the SIL Open Font License. Existing character and wordmark artwork is reused. This pack completes the artwork scope of section 9; it does not alter referral rewards or publish anything to the app.
