# Squish widgets — design and asset handoff

Small (free) and medium (Plus) widget designs, following the supplied extras brief. This is a design/resource package: it is not an installed WidgetKit extension or Android AppWidget and has no live data connection.

## Included

48 reference layouts: two sizes × six visual states × four modes. The five brief states include two “nothing logged” versions, morning and evening. States: nothing-morning, nothing-evening, on-track, reached, over, signed-out. Modes: light, dark, ios-tinted and android-neutral. Every layout is an editable SVG with outlined lettering, plus @2x and @3x PNGs.

16 additional size proofs cover 148/180-square small layouts and 300×148 / 380×180 medium layouts in every mode. Reference sizes are 158-square and 338×158 logical units. At compact medium heights below 154, nonessential secondary captions are omitted to make room for figures; the over-target amount must remain available. Native layout must adapt to actual available bounds; these are design examples, not guaranteed device sizes.

Separate mascot colour/alpha assets, six compositing layers per pose in light and dark, and pre-fitted colour/alpha PNGs for all 19 existing accessories are included. Seven character poses preserve the supplied character geometry. Only the known cream and dark-cream body palettes are provided; the app's other production colourways still need their own renders.

Platform resource folders contain an Apple WidgetAssets.xcassets image catalogue (light/dark appearances and separate template images) and Android drawable-nodpi PNG resources. Copy the resources into the native project and implement the widget layout separately.

## Review

Open index.html for a local mode-switching gallery. widget-overview.png compares all four modes. Each *-states.png sheet shows all six states in small and medium. layouts/ contains the individual vectors and PNGs. responsive-proofs/ contains alternative sizes. design-tokens.json and measurements.json specify colours, copy, sample values, geometry and CTA sizes.

## State and interaction rules

- Signed out: no nutrition or streak figures, no progress ring. Tap opens sign-in.
- Nothing logged: morning/evening greeting, zero progress and macros; no guilt or alarm. Time-of-day boundary is an app setting/product decision, not defined here.
- On track: remaining energy and a bounded progress ring.
- Target reached: “Nice one!” and “Target reached”, with a full ring.
- Over target: “Day by day” and the amount above target; same calm palette, full ring, no red or alarm.
- Small: whole widget opens the app, including sign-in when needed.
- Medium: “Log a meal” opens the logging flow; signed out becomes “Sign in”. Use a 44pt Apple / 48dp Android CTA target.

Use user-specific goals and actual logging data. The pictured 2,000-kcal target, macro amounts and 12-day streak are illustrative fixture data, not health recommendations. Clamp displayed ring/bar fractions to 0–1; keep actual numeric values honest. Never treat missing/stale data as zero intake. For a signed-in loading/error state, retain a clearly indicated last snapshot or defer display until valid data; the brief does not specify a loading/error design.

All status phrases contain at most three words. Native implementations should expose accessible spoken summaries of the figures and state, preserve locale formatting, support larger text and use live text. Outlined design SVGs are not a replacement for accessible dynamic UI text.

## Character compositing

All layers share the original 512-square coordinate system. PNGs are at 1536 square (3×), with @2x full-character exports where supplied. Resize every layer using the same transform.

Colour drawing order: shadow → accessory backs → base → face → face accessory front → neck accessory front → props → head accessory front → arms → accents. This keeps the watermelon and hands in front of scarves, as requested in the brief. Fitted accessory layers already contain pose transforms. Never transform them again. Use one accessory per slot.

assets/mascot/{light,dark}/ contains complete unaccessorized character renders. assets/mascot/layers/{mode}/{pose}/ supplies the individual compositing SVG/PNG layers. assets/accessories/index.json maps all 19 items to their colour and template layers.

Template PNGs use white RGB and alpha; facial marks are cut out of the body silhouette. Do not display these white files directly on white backgrounds: tint them through the native image system. Coloured ios-tinted SVGs/PNGs are visual proofs using an example green tint, not a hardcoded user tint. For an outfit, composite its colour layers in the documented order before deriving the final monochrome snapshot; naive stacking of independent opaque template pieces can obscure facial cutouts or pose occlusion.

## Platform implementation notes

Apple's accented widget rendering exposes explicit image rendering modes. Use the template assets with the native accented/tint rendering path and test the result with the user's chosen tint. The illustrated green shade is only a preview. See [Apple WidgetAccentedRenderingMode](https://developer.apple.com/documentation/widgetkit/widgetaccentedrenderingmode).

Android widget layouts must adapt to the size supplied by the launcher. The brief's 2×2 and 4×2 are target footprints, not fixed universal pixel dimensions. Use the neutral palette as a fallback and bind native theme colours where supported. See [Android app widgets overview](https://developer.android.com/develop/ui/views/appwidgets/overview) and [flexible widget layouts](https://developer.android.com/develop/ui/views/appwidgets/layouts).

Timeline/provider data, app-group/shared storage, log/sign-in routes, Plus entitlement checks, refresh scheduling, native text layout, accessibility and device testing remain application work. No app route strings have been invented or deployed.

## Verification and sources

SVGs have editable vector geometry and outlined Fredoka lettering; existing Squish wordmark paths are reused. No embedded raster, live SVG text, filters, masks or CSS classes. PNGs are renders of those existing vector assets. New widget assets were assembled without image generation or stock imagery. Font: Fredoka, SIL Open Font License.

The layouts and state sheets were rendered and inspected, including the over-target/signed-out states and a monochrome tint proof. validation.json records structural checks. Actual WidgetKit/Android rendering, tinted rendering on-device, launcher resizing, accessibility scaling and all twelve production body colourways remain untested.
