/**
 * Past chats with the nutritionist: what one is, what it is called, which
 * are kept and what goes back to the model when one is carried on. Kept apart
 * from where they are stored (chats.ts), so the lookups and the tests can use
 * it with no browser around.
 */
import type { ChatMessage } from './nutritionist-session';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  /** The lookups that went into an answer, shown above it. */
  lookups?: string[];
}

export interface PastChat {
  id: string;
  /** The first question, which is what a chat is remembered by. */
  title: string;
  startedAt: number;
  updatedAt: number;
  turns: ChatTurn[];
}

export const MAX_CHATS = 30;
export const MAX_AGE_DAYS = 90;
const TITLE_MAX = 80;

/* ------------------------------------------------------------------ *
 * The pure part: what a chat is called, which are kept, what matches.
 * ------------------------------------------------------------------ */

export const newChatId = (): string => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** A chat's name: its first question, on one line, cut at a word. */
export function titleOf(turns: ChatTurn[]): string {
  const first = turns.find((turn) => turn.role === 'user')?.text.replace(/\s+/g, ' ').trim() ?? '';
  if (first.length <= TITLE_MAX) return first;
  const cut = first.slice(0, TITLE_MAX);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : TITLE_MAX).trimEnd()}…`;
}

/** Newest first, the newest 30, none past 90 days: the rest are to be let go. */
export function keepFrom(chats: PastChat[], now = Date.now()): { keep: PastChat[]; drop: PastChat[] } {
  const oldest = now - MAX_AGE_DAYS * 86_400_000;
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  const keep = sorted.filter((chat) => chat.updatedAt >= oldest).slice(0, MAX_CHATS);
  const kept = new Set(keep.map((chat) => chat.id));
  return { keep, drop: sorted.filter((chat) => !kept.has(chat.id)) };
}

/**
 * What goes back to the model when a chat is carried on: the words, in turns.
 * Only whole exchanges — a question left without its answer (it failed) is
 * left out, as the screen left it out.
 */
export function wireOf(turns: ChatTurn[]): ChatMessage[] {
  const wire: ChatMessage[] = [];
  for (const turn of turns) {
    if (!turn.text.trim()) continue;
    const last = wire.at(-1);
    if (last?.role === turn.role) last.content = `${String(last.content)}\n\n${turn.text}`;
    else wire.push({ role: turn.role, content: turn.text });
  }
  if (wire.at(-1)?.role === 'user') wire.pop();
  return wire;
}
