import { useSyncExternalStore } from 'react';
import { planNow, watchStanding } from '../lib/plan';

const subscribe = (listener: () => void) => watchStanding(() => listener());

/** Whether the server last said this person is on Plus. Never read from storage. */
export const useSubscribed = (): boolean => useSyncExternalStore(subscribe, planNow).plan === 'plus';
