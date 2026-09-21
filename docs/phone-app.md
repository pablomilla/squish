# Squish on a phone

Capacitor wraps the web build in a native shell: same React app, same server,
running inside a web view that can do things a browser tab cannot — schedule a
reminder for breakfast, appear in the App Store, and later read from Apple
Health.

The web app is unchanged by this. Everything below is additive, and Squish in
a browser behaves exactly as it did.

## What is already done

- `capacitor.config.ts` — app id `app.squish.tracker`, bundling `dist/`.
- `ios/` and `android/` scaffolded, with the permission strings filled in.
  On iOS a missing `NSCameraUsageDescription` does not warn, it **crashes the
  app** the moment it touches the camera; all three are in `Info.plist`.
- Reminders rewritten onto `@capacitor/local-notifications`. The phone holds
  the schedule, so there is no server to keep awake at breakfast, and it works
  with no signal. The web-push machinery it replaces — `server/push.ts`,
  `public/sw.js`, the three `/api/push/*` routes, the `web-push` dependency and
  its setup script — is deleted.
- **Every API call goes through `apiUrl()`** (`src/lib/origin.ts`). This is the
  one that bites: in a browser `/api/chat` means the right thing because the
  page came from the server, and in the app the page is a file with no server
  behind it. A test walks `src/` and fails on any bare `fetch('/…')`.
- Status bar follows the theme; the splash screen goes when React has painted.

## What needs your Mac

None of it can be done or checked from a Linux container, and some of it
cannot be checked anywhere but a real phone.

### Once

1. **Xcode** from the App Store, then `xcode-select --install`.
2. **CocoaPods**: `brew install cocoapods`.
3. **Android Studio**, which brings the SDK and a device emulator.
4. An **Apple Developer** account (£79/year) to put anything on a real iPhone
   beyond your own, and a **Play Console** account ($25 once).

### Every build

```bash
# 1. Tell the app where its server is. Without this it throws on first call.
echo 'VITE_API_ORIGIN=https://your-squish.onrender.com' > .env.production

# 2. Build the web app and copy it into both platforms.
npm run build && npx cap sync

# 3. Open the native projects.
npx cap open ios        # Xcode: set the team, then run on a device
npx cap open android    # Android Studio: run
```

`npx cap sync` after every `npm run build`, or the app runs the last build you
copied.

### The first time in Xcode

- Signing & Capabilities → pick your team. The bundle id is
  `app.squish.tracker`; change it in `capacitor.config.ts` if you want your own.
- Add the **Push Notifications** capability? **No.** Local notifications need
  nothing; that capability is for the server-pushed kind Squish no longer uses.
- Run on a real device, not the simulator. The simulator has no camera, so the
  photo analysis and the barcode scanner cannot be tested on it at all.

## What to test on the device, in this order

The first three are the ones that can only fail here.

1. **The camera.** Photograph a meal. If the app dies the instant the camera
   opens, a usage string is missing from `Info.plist`.
2. **The barcode scanner.** The decoder is a megabyte of WebAssembly loaded
   from the bundle. It works in a browser; whether the web view fetches it the
   same way is unknown until you try.
3. **The API.** Anything that reaches the server — analysing a photo, asking
   the nutritionist. A failure here means `VITE_API_ORIGIN` is wrong or unset,
   and the error message says so.
4. **Reminders.** Set one for two minutes away, close the app completely, and
   wait. Then check it repeats the next day rather than firing once.
5. **Dictation.** `webkitSpeechRecognition` exists in Safari; whether it exists
   inside a WKWebView is genuinely uncertain, and if it does not the button
   simply will not appear, which is the designed behaviour rather than a break.
6. The notch and the home indicator, in both orientations and both themes.

## Known unknowns

Honestly: everything above the line has been typechecked, linted, built and
unit-tested, and **none of it has run on a phone.** The camera, the scanner,
the microphone and the notifications are all web APIs behaving inside a native
web view, which is a different thing from behaving in Safari. Expect the first
device run to find something.

The likeliest candidates, in order: dictation missing inside WKWebView; the
wasm decoder not loading from the bundle; and safe-area insets reading zero if
`viewport-fit=cover` does not survive the wrap.
