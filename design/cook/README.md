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

Each one with its pot, pan or plate **empty**: cook mode puts the step's own
foods in (src/components/StepArt.tsx). Optional food pictures go in `foods/`,
named after the ingredient (`salmon.png`, `broccoli.png`).

All eleven are in. What the app uses is a trimmed, 720-wide WebP of each in
src/assets/cook/, and where the foods sit on it is in `PLACES` in StepArt.tsx.
A new kind of step needs its picture here and there (a test checks), and a
line in `PLACES`.

The generator painted a checkerboard in rather than leaving the background
transparent, so the PNGs here are the cut-outs, not the originals.
