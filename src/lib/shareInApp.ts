/**
 * Shares arriving in the running app (src/lib/shareIn.ts has what they mean):
 * the link it was opened with, links while it runs, and on the iPhone what
 * the share extension left while Squish was closed.
 */
import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { isNative } from './origin';
import { shareFromLink, type Shared } from './shareIn';

const HANDLED = 'squish-share-handled';

/** Where the iPhone's share extension leaves a share when iOS will not let it open Squish (SceneDelegate.swift). */
const ShareInbox = registerPlugin<{ take: () => Promise<{ link?: string }> }>('ShareInbox');

/** Shares arriving in the app: the one it was opened with, and any while it is running. */
export function onShareIn(open: (shared: Shared) => void): () => void {
  if (!isNative()) return () => {};
  let live = true;
  void App.getLaunchUrl()
    .then((launch) => {
      const shared = launch?.url ? shareFromLink(launch.url) : null;
      if (!live || !shared || !launch) return;
      // Still the launch link after a reload: once is enough.
      try {
        if (sessionStorage.getItem(HANDLED) === launch.url) return;
        sessionStorage.setItem(HANDLED, launch.url);
      } catch {
        /* no storage: importing it twice is the lesser harm */
      }
      open(shared);
    })
    .catch(() => {});
  const listening = App.addListener('appUrlOpen', ({ url }) => {
    const shared = shareFromLink(url);
    // Opened with it: the copy left in the inbox is the same share, and goes too.
    if (shared) {
      open(shared);
      void takeInbox();
    }
  }).catch(() => null);

  // On the iPhone, whatever the share extension left while Squish was closed.
  const takeInbox = async (): Promise<Shared | null> => {
    if (Capacitor.getPlatform() !== 'ios') return null;
    try {
      const { link } = await ShareInbox.take();
      return link ? shareFromLink(link) : null;
    } catch {
      return null;
    }
  };
  const checkInbox = () =>
    void takeInbox().then((shared) => {
      if (live && shared && document.visibilityState === 'visible') open(shared);
    });
  checkInbox();
  const onVisible = () => document.visibilityState === 'visible' && checkInbox();
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    live = false;
    document.removeEventListener('visibilitychange', onVisible);
    void listening.then((handle) => handle?.remove());
  };
}
