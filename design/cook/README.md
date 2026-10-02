# Cook mode scenes

Drop the generated cook-mode pictures here, one per kind of step, as PNGs
with transparent backgrounds (3:2, about 1536 × 1024), named exactly:

| File | Step |
|---|---|
| `prep.png` | chopping board and knife |
| `rinse.png` | colander |
| `mix.png` | mixing bowl and spoon |
| `season.png` | plate and salt shaker |
| `boil.png` | saucepan of water on a hob |
| `fry.png` | frying pan |
| `bake.png` | oven with a tray |
| `grill.png` | griddle pan with flames |
| `blend.png` | blender |
| `rest.png` | plate and kitchen timer |
| `serve.png` | dinner plate, fork and knife |

Each one with its pot, pan or plate **empty**: the step's words and the
ingredient chips under the picture say what goes in.

## Seven more (since 1 October 2026): five in, two to paint

Cook mode only shows a picture that is right: a step that happens somewhere
none of these shows is labelled `other` and shown without one, and so are the
kinds below until their picture is here. A protein shake made in a shaker
bottle used to show the mixing bowl; it now shows the shaker.

In (2 October 2026), cut out of their painted checkerboard like the first
eleven: `shake`, `microwave`, `toast`, `airfry`, `chill` (painted as a small
fridge). These came at about 1024 wide rather than 1536, so their WebPs are
kept at the size the cut-out came to (up to 720) rather than stretched.
Still to paint: `assemble` and `pour`.

| File | Step | Paint |
|---|---|---|
| `shake.png` | shaker bottle (protein shakes) | a protein shaker bottle with its lid on and the flip-top cap closed, a little whisk ball visible through the side |
| `microwave.png` | microwave | a small countertop microwave, door closed, a dial and two buttons |
| `toast.png` | toaster | a two-slot toaster, slots empty, lever up |
| `airfry.png` | air fryer | a rounded air fryer with its basket drawer closed and one dial |
| `chill.png` | fridge (overnight oats, chilling) | a small fridge, door closed — or a lidded jar on a fridge shelf |
| `assemble.png` | putting a sandwich, wrap or bowl together | a wooden board with a butter knife resting on it, nothing on the board |
| `pour.png` | pouring a drink, milk on cereal | a jug and an empty glass beside it |

Same as the eleven: the soft, matte clay look (cream bodies, peach, lavender
and mint details, little raised dots), one object or a small group, centred,
lit from the top left, transparent background, 3:2 at about 1536 × 1024, and
every pot, glass and board **empty**.

When one arrives: trim it to a 720-wide WebP in src/assets/cook/ (as the
others were), and take its kind off `AWAITING_PICTURES` in
src/lib/cooking.ts — a test fails until both are done, so a picture cannot go
missing again once it is in.

## The first eleven

All eleven are in. What the app uses is a trimmed, 720-wide WebP of each in
src/assets/cook/ (src/components/StepArt.tsx). A new kind of step needs its
picture here and there; a test checks.

The generator painted a checkerboard in rather than leaving the background
transparent, so the PNGs here are the cut-outs, not the originals.
