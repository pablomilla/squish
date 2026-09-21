import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startNative } from './lib/native';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// After the render call, so the splash screen goes when there is something
// behind it. Nothing here is awaited: on the web it returns immediately, and
// on a phone a plugin that hangs must not hold the app shut.
void startNative(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
