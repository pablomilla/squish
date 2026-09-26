/**
 * Today's cheers, as kept on the phone (see the end of lib/squad.ts for why).
 * Pure, so it can be tested without a browser; the storage is in squad.ts.
 */
export interface InboxCheer {
  id: string;
  from: string;
  cheer: string;
}
export interface CheerInbox {
  date: string;
  cheers: InboxCheer[];
}

const INBOX_MAX = 10;

/** Today's cheers from what was stored: yesterday's are old news. */
export const inboxFor = (stored: CheerInbox | null, today: string): InboxCheer[] => (stored?.date === today ? stored.cheers : []);

/** Add arrivals to today's list, each once, newest first, a handful at most. */
export function addToInbox(stored: CheerInbox | null, arrived: InboxCheer[], today: string): CheerInbox {
  const kept = inboxFor(stored, today);
  const fresh = arrived.filter((c) => !kept.some((k) => k.id === c.id));
  return { date: today, cheers: [...fresh.reverse(), ...kept].slice(0, INBOX_MAX) };
}
