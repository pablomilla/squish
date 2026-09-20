# Portion accuracy, and the depth sensor Squish hasn't got

Portion size is where a photo-based food tracker lives or dies. Identifying
a chicken breast is easy. Knowing whether it is 120 g or 200 g is the whole
game, and it is worth about 150 kcal.

## What the numbers say

SnapCalorie publish figures for a 500 kcal dish:

| Method | Error |
|---|---|
| A person eyeballing it | ±265 kcal |
| Their app, ordinary iPhone | ±130 kcal |
| Their app, iPhone Pro with LiDAR | ±80 kcal |

The gap between the last two rows is the depth sensor. It is their genuine
advantage and it is not reachable from a web page: there is no browser API for
the iPhone's LiDAR scanner or for Android's depth cameras, and there is not
going to be one soon.

## What Squish does instead

A photograph has no scale unless something in it does. So:

**The plate is the ruler.** The You screen asks once for the width of your
dinner plate and the volume of your usual bowl. Most people eat most meals off
the same two or three things, so one measurement improves every photo after it.
Those numbers go into the prompt, and the model is told to prefer them over any
general assumption.

Nothing is assumed. There is no default plate size, and an early version that
shipped one was wrong to: the payoff is not symmetric. A correct size is real
information; an absent one is neutral, leaving the model on its priors about
ordinary portions; a wrong one is worse than either, because the food is scaled
by the ratio. Telling it 27 cm about a 20 cm plate makes the portion getting on
for twice what it was. So the setting reads "Not set" until somebody measures,
and says plainly that a guess makes things worse rather than better.

**Known objects in the frame.** The prompt carries a short table of things that
are reliably sized — a dinner fork is about 19 cm, a teaspoon 13 cm, a mug
300 ml, a can 330 ml, a credit card 8.6 cm, an adult palm about 9 cm across. A
plate shot from above gives a scale for everything on it.

**The capture guide says why.** "Whole plate in the frame — the rim is what
Squish measures against" is a more useful instruction than "good light",
because it tells you what the framing is *for*.

None of this closes the gap to a depth sensor. It should narrow it, because
the failure it addresses — no scale reference at all — is the one that
produces the worst errors.

**This is unmeasured.** The claim above is reasoning, not a result. Measuring
it needs the bench harness (`npm run bench`) run against weighed meals, with
and without a plate size set, and nobody has done that yet. Until someone does,
treat it as a plausible improvement rather than a proven one.

## What the native wrap would take

When Squish is wrapped with Capacitor for the App Store, real depth becomes
possible. Roughly:

1. **A Capacitor plugin wrapping ARKit** (iOS) and **ARCore Depth API**
   (Android). Neither has an off-the-shelf plugin that does food volume, so
   this is a plugin to write, in Swift and Kotlin.
2. **Capture a depth map alongside the photo.** On iOS that is
   `AVCapturePhotoOutput` with `isDepthDataDeliveryEnabled`, which works on any
   dual-camera iPhone, not only the Pro models with LiDAR. LiDAR is more
   accurate but the parallax depth from two lenses is a long way better than
   nothing.
3. **Turn depth into volume.** Segment the plate, take the surface height above
   it, integrate. This is the hard part and the part worth doing well.
4. **Send volume, not just pixels.** The model is then told "this portion
   occupies about 310 ml" rather than being asked to guess it, which changes
   the question from estimation to lookup.

Step 3 is a real piece of computer vision, not a weekend. Steps 1, 2 and 4 are
mostly plumbing. It would be reasonable to ship 1, 2 and 4 with a crude volume
estimate first — even a rough height map beats a flat photograph — and improve
step 3 afterwards.

## Cheaper things worth trying first

- **A second photo from an angle.** Two views constrain height a great deal
  better than one, and it costs a shutter press rather than a plugin. Worth
  measuring before building anything native.
- **Weighed-meal feedback.** People who own a kitchen scale could confirm a
  weight, and those confirmations would say how wrong the estimates actually
  are. At the moment nobody knows, including us.
