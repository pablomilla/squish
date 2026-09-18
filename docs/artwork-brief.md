# Artwork brief: every image file Squish needs

**For:** whoever draws the new logo and mascot — a designer, an illustrator, or you with an AI tool.

**The short version:** commission **three SVG files**. Everything else on this list I can generate
from them. Do not pay anyone to make thirty PNGs.

---

## 1. What to commission — three SVGs

These are the only files that need a human (or an AI) to draw them.

| File | What it is | Where it appears |
| --- | --- | --- |
| `squish-master.svg` | The character, full body, facing forward | Every screen in the app, and the share card |
| `squish-wordmark.svg` | The word "Squish" as a logo | Onboarding, lock screen, store listings |
| `squish-lockup.svg` | Character and wordmark together | Store listings, marketing, the Play feature graphic |

### How the character file must be built

Squish is not a picture in this app — he is **drawn in code** (`src/components/Squish.tsx`) out of
vector shapes. That is what lets him blink, bob, change colour in dark mode, and be baked into a
share card at any size. To keep all of that, the new drawing needs to arrive in pieces I can
re-assemble, not as one flattened shape.

**Name the groups/layers exactly this:**

```
body      the blob itself
shadow    the soft ellipse he sits on
face      eyes, mouth, blush — as three sub-groups: eyes, mouth, blush
arms      left and right as separate shapes
feet      left and right as separate shapes
```

**Seven moods** are built from those parts. Draw the face elements for each; the body is reused:

| Mood | Where it shows |
| --- | --- |
| `excited` | Default — home screen, most of the app |
| `nomnom` | After a meal is logged |
| `calm` | Empty states, quiet moments |
| `sleepy` | Late evening |
| `proud` | Goal hit, achievement unlocked |
| `cheering` | Streaks, and the share card |
| `thinking` | While the AI is reading a photo |

One file with a named group per mood face is ideal. Seven separate SVGs also works.

### Colours

The mascot is recoloured by the app, so draw him in these and keep flat fills:

| Use | Light | Dark mode |
| --- | --- | --- |
| Skin highlight | `#FFFAF4` | `#FDF3EA` |
| Skin mid | `#FDEADC` | `#F4DDCC` |
| Skin shade | `#F6D7C4` | `#E2BFA9` |
| Ink (eyes, mouth) | `#2B2340` | same |
| Blush / hearts | `#F4899F` | same |
| Sparks | `#F2C84B` | same |

Brand palette for the logo and any background shapes:

`#FDF6EC` cream · `#2B2340` ink · `#6B5FE0` purple · `#F4899F` pink · `#F7B98A` peach ·
`#7DC79A` mint · `#F2C84B` yellow

### Technical rules for the SVGs

- **Real vector paths.** An SVG containing `<image ... base64` is a PNG in a costume: it cannot be
  recoloured, animated, or scaled. Open the file in a text editor to check — you want to see
  `<path d="M256 96c-74...">`.
- **Text converted to outlines.** A font reference will not render on someone else's phone.
- Flat fills and simple linear/radial gradients only. **No blur filters, no drop shadows** — they
  render differently across browsers and are slow on older phones.
- A `viewBox` on the root, and **no fixed `width`/`height`** attributes.
- Keep the path count sane. A few dozen shapes, not a few thousand.

---

## 2. What I generate from those — the icon set

These go in `public/`. I can produce every one of them from `squish-master.svg` once it exists;
they are listed so you know what the app actually installs with.

| File | Size | Notes |
| --- | --- | --- |
| `squish-icon.svg` | 512 viewBox | Browser tab. **Exists today.** |
| `apple-touch-icon.png` | 180×180 | iPhone home screen. **Missing — see the bug below.** |
| `icon-192.png` | 192×192 | Android home screen |
| `icon-512.png` | 512×512 | Android splash and app switcher |
| `icon-maskable-512.png` | 512×512 | Android crops icons into a circle or squircle. The mascot must sit inside the middle 80%, with the background colour running right to the edges, or his ears get sliced off. |
| `favicon.ico` | 32×32 | Old browsers and bookmark bars |

**A live bug this fixes:** `index.html` currently points iPhones at an SVG for the home-screen
icon, and iOS ignores SVG there. Any tester who adds Squish to their home screen on an iPhone gets
a blank square instead of the mascot. `public/manifest.webmanifest` has the same gap on Android.
Twenty minutes of work, worth doing before the testers arrive.

Note for the icon artwork specifically: iOS and Android both apply their own rounded corners, so
the icon should be drawn as a **full square** with no corner rounding of its own.

---

## 3. Store submission — later, and mostly generated

Nothing here is needed until you submit. Sizes below were correct as of writing; both stores change
them, so **check the current requirements in App Store Connect and Play Console on the day you
submit** rather than trusting this table.

### Apple App Store

| Asset | Spec |
| --- | --- |
| App icon | 1024×1024 PNG, **no transparency, no alpha channel**, square, no rounded corners |
| iPhone screenshots | 3–10, PNG or JPEG, no transparency. 6.9" display (1320×2868) is the current requirement |
| iPad screenshots | Only if you ship an iPad version |
| App preview video | Optional, and skippable for launch |

### Google Play

| Asset | Spec |
| --- | --- |
| App icon | 512×512 PNG, 32-bit, transparency allowed |
| Feature graphic | **1024×500** PNG or JPEG — required, sits at the top of your listing |
| Phone screenshots | 2–8, PNG or JPEG, 16:9 or 9:16. 1080×1920 is the safe default |
| Adaptive icon | Foreground 432×432 PNG on transparency, plus a background colour. Mascot inside the middle 66% |

**The screenshots are photographs of the app, not drawings.** I can produce those with the same
tooling I have been using to test the screens — set up a realistic day of meals, render each screen
at the exact store size, and add the caption bars over the top. That is free and takes an hour.
Do not pay a designer for it.

---

## 4. What needs no files at all

Worth knowing so nobody quotes you for it:

- **The 22 interface icons** (camera, flame, water drop, trainer, heart, share…) are drawn in code
  in `src/components/icons.tsx`. They already match each other and follow the theme.
- **The share card** is drawn on the phone at 1080×1350 from the mascot that is already on screen.
- **Empty states and onboarding art** reuse the mascot's moods rather than separate illustrations.
- **Food photos** are the user's own, and never leave their phone.

---

## 5. If you are using an AI image tool

It will hand you a PNG. That is the wrong file type for the character, and converting it with a
"PNG to SVG" website produces the fake vector described above.

The workable route is: generate PNG concepts to decide what you *want* him to look like, then have
a designer redraw the chosen one properly in Figma or Illustrator as layered vector paths. A single
character redraw from a clear reference is a small, cheap job — an hour or two of a designer's time,
not a project.
