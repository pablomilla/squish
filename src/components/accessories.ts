/**
 * Loading accessory artwork only when somebody wears it.
 *
 * All nineteen together are about 235k of markup, and most people will wear
 * one or two, so each is its own chunk fetched the first time it is needed.
 * Until it arrives Squish is drawn without it, which for a moment on first
 * load is the right thing to show anyway.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { AccessoryArt } from '../lib/outfit';

const loaders = import.meta.glob<{ default: AccessoryArt }>('./accessory-art/*.ts');

const cache = new Map<string, AccessoryArt>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function load(id: string): void {
  const loader = loaders[`./accessory-art/${id}.ts`];
  if (!loader || cache.has(id) || loading.has(id)) return;
  loading.add(id);
  loader()
    .then((module) => {
      cache.set(id, module.default);
      version += 1;
      for (const listener of listeners) listener();
    })
    .catch(() => {
      // Offline, or a deploy moved the chunk: try again next time it is asked for.
    })
    .finally(() => loading.delete(id));
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The artwork for these items, as much of it as has arrived. */
export function useAccessoryArt(ids: string[]): Map<string, AccessoryArt> {
  useSyncExternalStore(subscribe, () => version);
  const key = ids.join(' ');
  useEffect(() => {
    for (const id of key.split(' ').filter(Boolean)) load(id);
  }, [key]);
  return cache;
}
