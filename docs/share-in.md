# Sharing into Squish

A recipe found in Safari, Chrome, TikTok or Instagram: tap Share, pick
**Squish**, and it opens on the recipe import with the link already read.
Words with no link ("two eggs on toast and a flat white" from Notes) open
Describe, typed in and not yet sent.

## How it works

Every way in arrives as one link — **`squish://share?url=…&text=…`** in the
app, **`/share?url=…&text=…`** on the web — and the app does the rest
(`src/lib/shareIn.ts`):

- The first web address anywhere in what was shared is the recipe, however
  the app wrapped it ("Made this tonight 🍝 https://… So good!"), with any
  trailing punctuation left behind.
- It opens on Import a recipe and reads it straight away. From there it is
  the ordinary import: **Use this** logs a helping, **Save to my recipes**
  keeps it in the recipe box.
- No link: Describe, with the words typed in. Nothing is sent until they
  press Work it out.
- Nothing at all: Home.

## The ways in

| Where | How | Files |
|---|---|---|
| Web app installed on Android | The manifest's `share_target` | `public/manifest.webmanifest` |
| Android app | A `SEND text/plain` intent filter; `MainActivity` hands it on as `squish://share` | `AndroidManifest.xml`, `MainActivity.java` |
| iPhone app | A Share Extension, which leaves the link in an App Group and tries to open Squish | `ios/App/SquishShare/`, `ios/App/App/SceneDelegate.swift` |

iPhones have no way for a web app to appear in the share sheet: that part
needs the app.

## Building them

What was checked here: the parsing is unit-tested; the web share target runs
end to end in Chromium (a TikTok-style share read as a recipe and saved, words
to Describe); the Android Java compiles against the Android 16 framework and
Capacitor's real `BridgeActivity` signatures. **The Swift has not been
compiled.**

### Android (Android Studio)

Nothing to set up. Build and run, then share a web page from Chrome and pick
Squish.

### iPhone (Xcode) — once

1. `npm run build && npx cap sync && npx cap open ios`
2. **File → New → Target… → Share Extension.** Product name **`SquishShare`**.
   Activate the scheme if asked.
3. Delete the template's `ShareViewController.swift` and `MainInterface.storyboard`
   (Move to Trash), then drag `ios/App/SquishShare/ShareViewController.swift`
   into the SquishShare group, ticking only the **SquishShare** target. Use
   this folder's `Info.plist` in place of the generated one — it has no
   storyboard and lets through a web link or text.
4. SquishShare target → General → **Minimum Deployments: iOS 16.0**.
5. **Signing & Capabilities → + Capability → App Groups**, on **both** the
   **App** target and **SquishShare**, with the same group:
   **`group.app.squish.tracker`**. (The app reads the link the extension
   leaves there; without the group they cannot see each other.)
6. Run the App scheme on a phone. In Safari, Share → (More…) → Squish.

## What to test on a phone

1. **Safari, Squish closed.** Share a recipe page to Squish. Either Squish opens
   on the import, or the sheet says "Sent to Squish" — then open Squish and it
   is there, being read.
2. **Squish in the background.** The same; it should switch to the import.
3. **TikTok or Instagram.** Share a video's link: the link inside the text is
   the one read. A video with no written recipe gives a thin result, which is
   the page's fault, not the share's.
4. **Notes.** Share a line of text: Describe, typed in, not sent.
5. **Android.** Chrome → Share → Squish: the import opens and reads.

## Known unknowns

- **Opening Squish from the iPhone extension.** iOS offers share extensions no
  supported way to open their app. The extension tries the long-standing way
  round it; on recent iOS that may quietly do nothing, which is why the link
  is also left in the App Group and the sheet always says where to find it.
  If it never opens, the share still works — it is one tap more.
- Share sheet labels are English for now, like the widget's.
