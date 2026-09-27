# Sign in with Google and Apple

"Continue with Apple" and "Continue with Google" sit above the email form on
onboarding's last step, on the welcome screen's sign-in, and on You → Account.
Each button appears only once its provider is set up below. Until then the
app offers email and password, as before.

How it works is in `server/federated.ts` (checking the token, finding or
making the account) and `src/components/SignInWith.tsx` (the buttons).
Nothing is loaded from Google or Apple until somebody taps one of the
buttons. The privacy policy promises this.

Neither button is offered inside the phone app. Google refuses web sign-in
in an embedded browser, and Apple's belongs to the native sheet. Supporting
them there needs a native plugin, which is a later job.

## Google

1. In [Google Cloud Console](https://console.cloud.google.com/), pick or make
   a project, then go to **APIs & Services → OAuth consent screen**.
   - User type: **External**.
   - App name: Squish. Support email: yours. Logo: the Squish icon.
   - App domain: `https://squish.online`. Privacy policy:
     `https://squish.online/privacy`.
   - Scopes: only `openid` and `.../auth/userinfo.email`. Nothing sensitive,
     so no verification review is needed.
   - Publish the app, so it leaves "Testing". Otherwise only listed test
     users can sign in.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Authorised JavaScript origins: `https://app.squish.online`.
   - Authorised redirect URIs: `https://app.squish.online/api/auth/return`.
3. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`. The
   client secret is not needed.
4. In Render, open the Squish service → **Environment**, add
   `GOOGLE_CLIENT_ID` = that client ID, and save. It redeploys.

To also accept tokens from another client, for example a future Android app,
list the client IDs separated by commas.

## Apple

This needs an Apple Developer Program membership ($99 a year).

1. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list):
   - Make an **App ID** for Squish, if there isn't one, with the
     **Sign In with Apple** capability ticked.
   - Make a **Services ID** (Identifiers → + → Services IDs), for example
     `online.squish.signin`. This is the web client ID. Tick **Sign In with
     Apple**, then **Configure**:
     - Primary App ID: the App ID above.
     - Domains: `app.squish.online`.
     - Return URLs: `https://app.squish.online/`.
2. In Render, add `APPLE_CLIENT_ID` = the Services ID (for example
   `online.squish.signin`) and save.
   - If the return URL registered with Apple is anything other than the
     app's own address with a trailing `/`, also set `APPLE_REDIRECT_URI` to
     exactly what you registered.

Apple lets people hide their address. Those accounts get a
`…@privaterelay.appleid.com` address, which forwards to them. For emails to
reach them, register Squish's sending domain under **Sign in with Apple for
Email Communication** in the same portal (More → Configure).

## What happens when somebody signs in

The server checks the token's signature against Google's or Apple's
published keys. It also checks the token was issued by them, for Squish's
client ID, recently, and for this attempt (the nonce). Then it picks one
Squish account per person:

- **The same Google or Apple account as before:** that Squish account.
- **An existing Squish account on the same, provider-verified address:**
  linked to it. The password still works. If that address was never
  confirmed, its password is replaced and its other devices are signed out.
  Someone may have signed up with another person's address and waited, so
  the account goes to the address's real owner.
- **Neither:** a new account, with the address already confirmed and a
  password nobody knows. "I have forgotten my password" sets one, for anyone
  who later wants to sign in without Google or Apple.

A code the person arrived with, or typed during onboarding, is applied to a
new account exactly as it is at email sign-up.
