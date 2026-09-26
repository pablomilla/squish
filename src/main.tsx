import './styles/global.css';
import { chooseLanguage } from './boot/language';

/*
 * The language first, then everything else.
 *
 * The rest of the app is imported only once the catalog for their language
 * is in place, because a good many strings are translated as their modules
 * load. The splash screen in index.html covers the wait, which is nothing
 * at all for English or a language already cached.
 */
async function start(): Promise<void> {
  await chooseLanguage();

  const [{ StrictMode }, { createRoot }, { default: App }, { startNative }, { arriveFromOldAddress }, { apiUrl }, { catchReferral }, { catchSquadInvite }] =
    await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('./App'),
      import('./lib/native'),
      import('./lib/identity'),
      import('./lib/origin'),
      import('./lib/referral'),
      import('./lib/squad'),
    ]);

  // Before anything renders, so the first question about who this browser is
  // waits for the answer. Does nothing unless the address carries a handoff.
  void arriveFromOldAddress(apiUrl);
  // An affiliate's link: remembered for a sign-up, and taken out of the address.
  catchReferral();
  // A squad's link: remembered until they can join, and taken out of the address.
  catchSquadInvite();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // After the render call, so the splash screen goes when there is something
  // behind it. Nothing here is awaited: on the web it returns immediately, and
  // on a phone a plugin that hangs must not hold the app shut.
  void startNative(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
}

void start();
