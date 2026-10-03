# Quick snap and the widgets

For when there is no time, or holding a phone up for half a minute would be
rude: one tap on a widget opens Squish's camera, one tap takes the photo, and
the phone goes back in the pocket. The meal is read in the background and
turns up in the diary marked **to check**, for when there is a moment.

Beside the button the widget shows **today at a glance**: what is left (or
over), how far through the day's energy, the protein, and one line worth a
glance — snaps being read, snaps to check, or the streak.

## What each widget shows

| Widget | Shows | A tap |
|---|---|---|
| iPhone small | A ring of the day's energy with the camera in it, and what is left | Quick snap |
| iPhone medium | What is left, a bar, eaten of target, protein, the one line; a big Quick snap button | The button snaps; the rest opens Squish |
| iPhone Lock Screen, circular | The same ring, small, round the camera | Quick snap |
| iPhone Lock Screen, rectangular | Quick snap, and what is left | Quick snap |
| Android, 4×2 (its usual size) and up | As the iPhone's medium | The button snaps; the rest opens Squish |
| Android, made smaller | Just the Quick snap button | Quick snap |
| Control Centre, Action Button | Just Quick snap | Quick snap |

Without a summary from the app — a new install, before Squish has been
opened — or with the numbers turned off, every widget is just the Quick snap
button.

### Where the numbers come from

The widgets cannot read the diary, so the app works out a small summary
(`src/lib/widgetData.ts`): today's energy eaten and target in the person's
unit, protein, the streak, snaps to check and being read, and the widget's
words, already in the person's language. `src/components/WidgetSync.tsx`
sends it to the phone a moment after anything changes and when the app is put
away, only if it is different (phones ration widget redraws), through a small
plugin in each native project:

- **iPhone:** `WidgetBridge` in `ios/App/App/SceneDelegate.swift` keeps it in
  the App Group `group.app.squish.tracker` (the one the share extension
  uses) and asks WidgetKit to redraw.
- **Android:** `WidgetBridgePlugin.java` keeps it in the app's own
  preferences and redraws `SnapWidgetProvider`.

The widgets fill in the numbers themselves (`{n}`, `{eaten}`, `{target}` in
the words), so they can start a new day on their own: a summary dated
yesterday means nothing eaten yet today, and the whole target left. The
iPhone's timeline has an entry at midnight for that; Android sets an alarm
for just after midnight that does not wake the phone.

**Privacy.** The summary stays on the phone and never has the meals in it.
Anybody who can see the Home Screen can see the numbers, so **You → Quick
snap → On the widget** can turn them off ("Just Quick snap"), for that phone.
On the iPhone the numbers are marked `privacySensitive`, so the Lock Screen
can hide them while the phone is locked.

## How it works

Everything opens the same link: **`squish://snap`** in the app, **`/?snap`**
on the web. The web app does the rest, so the widgets themselves are tiny and
never change.

1. **Straight into the camera** (`src/screens/QuickSnap.tsx`). It does not
   wait for the server to wake, for Home, or for anything else. There is
   nothing to choose: the meal slot comes from the clock.
2. **Kept at once** (`src/lib/snaps.ts`). The photo goes into IndexedDB and a
   note of it into the store before anything touches the network. With no
   signal it waits, and goes when the signal comes back.
3. **Read on the server** (`server/snaps.ts`, `POST /api/snaps`). A phone that
   has been put away stops running the app within seconds, and a read takes
   longer than that, so the photo is handed over (a second or two) and the
   server reads it whether or not the app is still open. It counts as one
   photo read, like any other. A read cut off by a deploy is started again the
   next time the app asks; an abandoned one is failed and its read given back.
4. **Collected and logged** the next time the app is open
   (`GET /api/snaps`), at the time the photo was taken, marked `quick`. The
   server then forgets it (`POST /api/snaps/collected`). The photo is deleted
   from the server as soon as it has been read; nothing waits there more than
   a week.
5. **Checked later.** Home shows a Quick snaps card (being read, stuck, and
   logged to check), and the diary marks the meal **to check**. "Looks right"
   clears it, and so does changing it in Review.

Where the server has no database (local development), there are no devices to
keep snaps for: the app reads the photo itself, while it is open.

## The ways in

| Where | What | Files |
|---|---|---|
| iPhone Home Screen | Small widget | `ios/App/SquishWidgets/` |
| iPhone Lock Screen | Circular and rectangular widgets | `ios/App/SquishWidgets/` |
| Control Centre, Action Button (iOS 18) | A control | `ios/App/SquishWidgets/` |
| Android home screen | 4×2 widget with today, resizable down to the button alone | `android/…/SnapWidgetProvider.java`, `WidgetBridgePlugin.java`, `res/layout/widget_today.xml`, `res/layout/widget_snap.xml`, `res/xml/widget_snap_info.xml` |
| Android, touch and hold the icon | Static shortcut | `res/xml/shortcuts.xml` |
| Web app installed on Android | Manifest shortcut | `public/manifest.webmanifest` |
| Inside the app | You → Quick snap → Try it now | `src/components/QuickSnapHelp.tsx` |

## Building them

None of the native parts can be built or run in the Linux container this was
written in. What was checked there: the Android widget's Java compiles
against the real Android 16 framework, every XML and plist file parses, and
the web side runs end to end in Chromium with a fake camera. **The Swift has
not been compiled.** Expect the first build to find something.

### Android (Android Studio)

Nothing to set up: the widget, the shortcut and the `squish://snap` link are
in the manifest already, and the bridge is registered in `MainActivity`.

```bash
npm run build && npx cap sync && npx cap open android
```

Run it, then touch and hold the home screen → Widgets → Squish → Quick snap.
It goes in at 4×2 with today showing; resize it smaller for just the button.
Touch and hold the Squish icon for the shortcut.

### iPhone (Xcode) — once

The widget is its own target, which only Xcode can add to the project.

1. `npm run build && npx cap sync && npx cap open ios`
2. **File → New → Target… → Widget Extension.** Product name
   **`SquishWidgets`**. Untick *Include Configuration App Intent* and *Include
   Live Activity*; tick *Include Control* only if you want Xcode's sample to
   delete (it is replaced below). Finish, and **Activate** the scheme if asked.
3. Xcode makes a `SquishWidgets` folder with its own sample files. **Delete
   all of its `.swift` files** (Move to Trash), then drag
   `ios/App/SquishWidgets/SquishWidgets.swift` from Finder into that group,
   ticking only the **SquishWidgets** target. Use this folder's `Info.plist`
   in place of the generated one, or check the generated one says
   `com.apple.widgetkit-extension`.
4. Select the **SquishWidgets** target → General → **Minimum Deployments:
   iOS 17.0**. (The app itself still runs on iOS 15; older phones just do not
   offer the widget.)
5. Signing & Capabilities for the extension: the same team as the app. Its
   bundle id should be **`app.squish.tracker.SquishWidgets`**.
6. **+ Capability → App Groups** on the **SquishWidgets** target, ticking
   **`group.app.squish.tracker`** — the same group the App and the share
   extension already have (docs/share-in.md). Without it the widget never
   sees today's numbers and is just the Quick snap button.
7. Run the **App** scheme on a phone (not the simulator: it has no camera).

## What to test on a phone

1. **Cold start.** Force-quit Squish, tap the widget: the camera should be
   up in about a second, with no Home or waking screen first.
2. **Warm start.** With Squish in the background on another screen, tap the
   widget: it should switch to the camera.
3. **Put it away.** Snap, lock the phone at once, wait half a minute, open
   Squish: the meal is in the diary, marked to check, with its photo.
4. **No signal.** Aeroplane mode, snap, open Squish later with signal: Home
   says it is waiting, then logs it.
5. **Lock Screen and Control Centre** (iOS 18): the same as 1. If the control
   opens Squish but not the camera, `OpenURLIntent` is not taking the custom
   scheme from a control on that iOS version — tell me and it can be done with
   an intent the app handles itself instead.
6. **Android Done button.** After a snap, Done should drop you back where you
   were (the app minimises). On iOS it goes to Home: no app may close itself.

7. **Today on the widget.** Log a meal, go to the Home Screen: within a few
   seconds the widget says what is left. Delete it in the app: the widget
   follows. The next morning, before opening Squish, the widget should show
   the whole target left.
8. **Numbers off.** You → Quick snap → Just Quick snap: the widget becomes
   the plain button. Lock the iPhone with the rectangular Lock Screen widget
   showing: the number should be hidden.
9. **Android sizes.** Resize the widget smaller than 4×2: it becomes the
   plain button; back to 4×2, today comes back.

## Known unknowns

- The iOS control's `OpenURLIntent` with a custom scheme is the least certain
  part. The widget's `widgetURL` is the long-established way and should be
  fine.
- `App.getLaunchUrl()` on a cold start from a widget is read once per session,
  so a page reload does not reopen the camera. If the camera does *not* open on
  a cold start, the launch URL is arriving later than the app asks for it.
- The words with numbers are the app's, translated as usual. The labels the
  widgets show before the app has sent anything, and the widget picker's
  name and description, are English for now: see **To do** below.
- **The Swift has not been compiled** (no Xcode here). The Java compiles
  against the Android framework.

## To do once the widgets are running on a phone

**Translate the widget labels.** The app's own words are translated as usual,
but the widgets' are not: they live in the native projects, outside the
catalog. Wait until both widgets have been seen working on a real phone, so
the wording is settled before it is put into 24 languages. Then:

- **Android:** the four strings marked "Quick snap" in
  `android/app/src/main/res/values/strings.xml` (`widget_snap_label`,
  `widget_snap_name`, `widget_snap_description`, `shortcut_snap_long`), copied
  into a `values-<lang>/strings.xml` for each language in
  `src/lib/language.ts` (`values-es`, `values-zh-rCN`, `values-pt-rPT`, …).
- **iPhone:** the text in `ios/App/SquishWidgets/SquishWidgets.swift` ("Quick
  snap", "Squish", the two descriptions). Add a String Catalog
  (`Localizable.xcstrings`) to the SquishWidgets target in Xcode; it picks up
  every `Text` and `LocalizedStringResource` from the Swift, and the
  translations go in there.
- The words to use are already translated in the app's catalog: "Quick snap"
  is on You, and the description matches the one in
  `src/components/QuickSnapHelp.tsx`. Take those rather than translating them
  afresh, so the widget and the app say the same thing.
