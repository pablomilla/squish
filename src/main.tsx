import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startNative } from './lib/native';
import { arriveFromOldAddress } from './lib/identity';
import { apiUrl } from './lib/origin';
import { catchReferral } from './lib/referral';
import './styles/global.css';

// Before anything renders, so the first question about who this browser is
// waits for the answer. Does nothing unless the address carries a handoff.
void arriveFromOldAddress(apiUrl);
// An affiliate's link: remembered for a sign-up, and taken out of the address.
catchReferral();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// After the render call, so the splash screen goes when there is something
// behind it. Nothing here is awaited: on the web it returns immediately, and
// on a phone a plugin that hangs must not hold the app shut.
void startNative(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
