/**
 * "Continue with Apple" and "Continue with Google": the quickest way to an
 * account, above the email form wherever there is one.
 *
 * Nothing is fetched from Google or Apple until one of these is tapped: the
 * privacy policy promises no third-party requests, and a sign-in script
 * loaded with the screen would tell Google about everybody who merely saw
 * it. So:
 *
 * - Google opens its own sign-in in a popup, asked for an ID token directly
 *   (OpenID Connect), which comes back to /api/auth/return on this server —
 *   a tiny page that hands it to this window and closes.
 * - Apple's script is loaded on the tap, and shows Apple's own popup.
 *
 * Either way the token goes to the server to be checked (server/federated.ts).
 * A provider not set up on the server is not offered, and neither is offered
 * inside the phone app, where Google refuses web sign-in in an embedded
 * browser and Apple's belongs to the native sheet.
 *
 * Both buttons are drawn to their owners' guidelines: Apple's black with its
 * logo, Google's white with its "G".
 */
import { useEffect, useRef, useState } from 'react';
import { providerSetup, signInWith, type Arrived, type ProviderSetup } from '../lib/account';
import { apiUrl, isNative } from '../lib/origin';
import { t } from '../lib/i18n';
import './sign-in-with.css';

const APPLE_SCRIPT = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';

interface AppleId {
  auth: {
    init: (options: Record<string, unknown>) => void;
    signIn: () => Promise<{ authorization?: { id_token?: string } }>;
  };
}
type Scripted = typeof globalThis & { AppleID?: AppleId };

let appleScript: Promise<void> | null = null;
function loadApple(): Promise<void> {
  appleScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = APPLE_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      appleScript = null;
      reject(new Error('Could not load Apple sign-in'));
    };
    document.head.appendChild(script);
  });
  return appleScript;
}

/** Fresh for every attempt: the token must carry the nonce back, so an old token cannot be replayed here. */
const random = (): string => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
};

/** Where Google sends the popup back to: a page on this server that passes the token over. */
const googleReturn = (): string => new URL(apiUrl('/api/auth/return'), window.location.href).href;

export type SignedInWith = Arrived & { created?: boolean };

export default function SignInWith({ onDone, onTrouble }: { onDone: (who: SignedInWith) => void; onTrouble: (message: string) => void }) {
  const [providers, setProviders] = useState<ProviderSetup | null>(null);
  const [busy, setBusy] = useState(false);
  // Held in refs so the provider scripts, set up once, always call the latest.
  const done = useRef(onDone);
  const trouble = useRef(onTrouble);
  useEffect(() => {
    done.current = onDone;
    trouble.current = onTrouble;
  }, [onDone, onTrouble]);

  useEffect(() => {
    if (isNative()) return;
    let live = true;
    void providerSetup().then((found) => live && setProviders(found));
    return () => {
      live = false;
    };
  }, []);

  const finish = async (provider: 'google' | 'apple', token: string, nonce: string) => {
    setBusy(true);
    const answer = await signInWith(provider, token, nonce);
    setBusy(false);
    if (answer.ok) done.current(answer);
    else trouble.current(answer.message);
  };

  /*
   * Google, in a popup opened on the tap itself (a popup opened later is
   * blocked). The answer arrives as a message from /api/auth/return, from
   * this origin only, carrying the state this attempt made.
   */
  const google = () => {
    const setup = providers?.google;
    if (!setup) return;
    const nonce = random();
    const state = random();
    const url = new URL(GOOGLE_AUTH);
    url.search = new URLSearchParams({
      client_id: setup.clientId,
      redirect_uri: googleReturn(),
      response_type: 'id_token',
      scope: 'openid email',
      nonce,
      state,
      prompt: 'select_account',
    }).toString();
    const popup = window.open(url.href, 'squish-google', 'popup,width=480,height=640');
    if (!popup) {
      trouble.current(t('Your browser blocked the Google window. Allow pop-ups for Squish and try again.'));
      return;
    }
    const origin = new URL(googleReturn()).origin;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      const answer = (event.data as { squishAuth?: Record<string, string> } | null)?.squishAuth;
      if (!answer || answer.state !== state) return;
      window.removeEventListener('message', onMessage);
      if (answer.id_token) void finish('google', answer.id_token, nonce);
      else if (answer.error && answer.error !== 'access_denied') trouble.current(t('Google sign-in did not work just then. Try again, or use your email.'));
    };
    window.addEventListener('message', onMessage);
  };

  const apple = async () => {
    const setup = providers?.apple;
    if (!setup) return;
    const nonce = random();
    try {
      await loadApple();
      const AppleID = (globalThis as Scripted).AppleID;
      if (!AppleID) throw new Error('no Apple');
      AppleID.auth.init({ clientId: setup.clientId, scope: 'email', redirectURI: setup.redirectUri, nonce, usePopup: true });
      const answer = await AppleID.auth.signIn();
      const token = answer.authorization?.id_token;
      if (token) await finish('apple', token, nonce);
    } catch (error) {
      // Closing Apple's window is a change of mind, not a failure.
      const code = (error as { error?: string })?.error;
      if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize') return;
      trouble.current(t('Apple sign-in did not work just then. Try again, or use your email.'));
    }
  };

  if (!providers || (!providers.google && !providers.apple)) return null;

  return (
    <div className="sign-in-with" aria-busy={busy}>
      {providers.apple && (
        <button type="button" className="apple-button" onClick={() => void apple()} disabled={busy}>
          <svg viewBox="0 0 17 20" aria-hidden="true" width="16" height="19">
            <path
              fill="currentColor"
              d="M14.2 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.7 4.8 2 5.8 1.1 7.4c-1.9 3.2-.5 8 1.3 10.6.9 1.3 1.9 2.7 3.3 2.6 1.3-.1 1.8-.9 3.4-.9 1.6 0 2 .9 3.4.8 1.4 0 2.3-1.3 3.2-2.6 1-1.5 1.4-2.9 1.4-3-.1 0-2.9-1.1-2.9-4.3zM11.6 3c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z"
            />
          </svg>
          {t('Continue with Apple')}
        </button>
      )}
      {providers.google && (
        <button type="button" className="google-button" onClick={google} disabled={busy}>
          <svg viewBox="0 0 48 48" aria-hidden="true" width="18" height="18">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.2C12.4 13.6 17.7 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z" />
            <path fill="#FBBC05" d="M10.6 28.5c-.5-1.4-.8-2.9-.8-4.5s.3-3.1.8-4.5l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.2z" />
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
          </svg>
          {t('Continue with Google')}
        </button>
      )}
      <p className="sign-in-or tiny muted" aria-hidden="true">
        <span>{t('or with your email')}</span>
      </p>
    </div>
  );
}
