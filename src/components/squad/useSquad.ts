import { useSyncExternalStore } from 'react';
import { squadNow, watchSquad, type SquadState } from '../../lib/squad';

/** The squad, as last heard from the server; one copy for every screen. */
export const useSquad = (): SquadState => useSyncExternalStore(watchSquad, squadNow);
