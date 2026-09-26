import { useSyncExternalStore } from 'react';
import { cheerInbox, inboxFor, squadNow, watchCheerInbox, watchSquad, type InboxCheer, type SquadState } from '../../lib/squad';
import { isoDate } from '../../lib/date';

/** The squad, as last heard from the server; one copy for every screen. */
export const useSquad = (): SquadState => useSyncExternalStore(watchSquad, squadNow);

/** Cheers received today and not yet looked at in the squad. */
export const useCheerInbox = (): InboxCheer[] => inboxFor(useSyncExternalStore(watchCheerInbox, cheerInbox), isoDate());
