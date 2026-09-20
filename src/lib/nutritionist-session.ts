/**
 * One conversation with the nutritionist, from question to answer.
 *
 * This is the part that is neither the browser's nor the server's: the summary
 * of the diary that goes up with every question, and the loop that carries a
 * question through however many lookups it takes. Both used to live in the
 * screen and the API client, which was fine until something other than a
 * browser needed to hold a conversation — an eval, a test, a script — and
 * found that the only copy of the loop was wrapped around `fetch`.
 *
 * So `step` is injected. In the app it posts to `/api/chat`; anywhere else it
 * can call the server's own `chatStep` directly. Everything the model actually
 * sees is the same either way, which is the whole point: an eval that measures
 * a reimplementation of the app measures nothing.
 */
import type { MealEntry, Profile, Targets } from '../types';
import { isoDate, lastDays } from './date';
import { mealsOn, series, streakOf, summarise, totalsOn } from './selectors';
import { saltGrams } from './units';
import type { ToolAnswer, ToolCall } from './nutritionist-tools';
import { toolLabel } from './nutritionist-tools';

/** The outline of their diary that rides along with every question. */
export interface ChatContext {
  goal: string;
  calorieTarget: number;
  proteinTarget: number;
  today: string;
  week: string;
  streak: number;
  recentMeals: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | unknown[];
}

export type ChatStep =
  | { done: true; reply: string }
  | { done: false; assistant: unknown[]; calls: ToolCall[] };

/**
 * What it is told before it looks anything up.
 *
 * Deliberately thin — a week in outline and the last few meals. Anything more
 * would be paying to send the whole diary on every question when most
 * questions need none of it, and anything older or finer is a lookup away.
 */
export function contextFor(
  meals: MealEntry[],
  targets: Targets,
  profile: Pick<Profile, 'goal'>,
  today = isoDate(),
): ChatContext {
  const todayTotals = totalsOn(meals, today);
  const mealCount = mealsOn(meals, today).length;
  const week = summarise(series(meals, lastDays(7, today), targets), targets);
  const salt = saltGrams(todayTotals.sodium ?? 0);

  return {
    goal: profile.goal,
    calorieTarget: targets.calories,
    proteinTarget: targets.protein,
    today: todayTotals.calories
      ? `${Math.round(todayTotals.calories)} kcal, ${Math.round(todayTotals.protein)} g protein, ` +
        `${Math.round(todayTotals.fibre)} g fibre, ${salt} g salt, across ${mealCount} meal${mealCount === 1 ? '' : 's'}`
      : 'nothing logged yet',
    week: week.loggedDays
      ? `${week.loggedDays} of 7 days logged, averaging ${week.avgCalories} kcal, ` +
        `${week.avgProtein} g protein and ${week.avgFibre} g fibre, quality score ${week.avgScore}`
      : 'nothing logged',
    streak: streakOf(meals, today),
    recentMeals: meals.slice(-8).map((m) => `${m.title} (${Math.round(m.nutrients.calories)} kcal)`),
  };
}

/** Matches the server's own cap, so the caller stops where the server would. */
export const MAX_TOOL_ROUNDS = 6;

export interface ConversationResult {
  reply: string;
  /** The whole conversation, lookups and all, ready to carry on from. */
  messages: ChatMessage[];
  /** What it looked up on the way, in order, for the screen and for the record. */
  lookups: ToolCall[];
}

/**
 * Ask, and run whatever it wants to look up, until it has an answer.
 *
 * The lookups run wherever `run` runs them — in the app that is the browser,
 * against the store, which is why the food never has to leave it.
 */
export async function runConversation(options: {
  messages: ChatMessage[];
  context: ChatContext;
  notes: () => { id: string; note: string }[];
  step: (messages: ChatMessage[], context: ChatContext, notes: { id: string; note: string }[]) => Promise<ChatStep>;
  run: (call: ToolCall) => ToolAnswer | Promise<ToolAnswer>;
  onLookup?: (labels: string[]) => void;
}): Promise<ConversationResult> {
  const messages = [...options.messages];
  const lookups: ToolCall[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const step = await options.step(messages, options.context, options.notes());
    if (step.done) return { reply: step.reply, messages, lookups };

    lookups.push(...step.calls);
    options.onLookup?.(step.calls.map(toolLabel));
    messages.push({ role: 'assistant', content: step.assistant });
    // Every result in one message, which is what the API expects — a separate
    // message per lookup trains it out of asking for two at once.
    messages.push({ role: 'user', content: await Promise.all(step.calls.map(options.run)) });
  }

  // Unreachable in practice: the server withholds the tools at the same count.
  return { reply: 'I got lost looking things up. Ask me again?', messages, lookups };
}
