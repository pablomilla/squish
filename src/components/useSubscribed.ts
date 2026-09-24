import { useSyncExternalStore } from 'react';
import { planNow, watchStanding, type Standing } from '../lib/plan';

const subscribe = (listener: () => void) => watchStanding(() => listener());

/** What the server last said about this person. Never read from storage. */
export const useStanding = (): Standing => useSyncExternalStore(subscribe, planNow);

/** Whether the server last said this person is on Plus. */
export const useSubscribed = (): boolean => useStanding().plan === 'plus';
