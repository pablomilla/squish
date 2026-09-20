/**
 * What the nutritionist can look up, and what it can remember.
 *
 * The unusual part: none of these run here. Squish keeps every diary in the
 * browser and the server has never held a single meal, so the tools are
 * *declared* on this side and *executed* on the other. The server asks for a
 * lookup, the browser answers it out of its own store, and the loop continues.
 * The food never crosses the wire in one direction and the API key never
 * crosses it in the other.
 *
 * That is also why the descriptions below are written so carefully. A model
 * that cannot see the data has only the description to go on when deciding
 * which tool answers the question in front of it.
 */
import type Anthropic from '@anthropic-ai/sdk';

const ISO_DATE = 'an ISO date, yyyy-mm-dd';

export const NUTRITIONIST_TOOLS: Anthropic.Tool[] = [
  {
    name: 'look_up_days',
    description:
      'Day-by-day totals from their diary for a date range: energy, protein, carbs, fat, fibre, saturates, free sugars, salt, and the quality score. ' +
      'Use this for anything about a particular day or a trend over time — "how was Tuesday", "have my weekends been worse", "is my protein improving". ' +
      'Ranges longer than about six weeks are trimmed, so ask for the window you actually need.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: `First day, ${ISO_DATE}` },
        to: { type: 'string', description: `Last day inclusive, ${ISO_DATE}` },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'find_meals',
    description:
      'Individual meals they logged, newest first, with their foods and nutrition. ' +
      'Use this when the question is about what they actually ate rather than the totals — "when did I last have fish", "what was that curry", "what do I usually have for breakfast". ' +
      'Give a query to match against meal and food names, or leave it out to get everything in the range.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to match in the meal or food names. Omit to match everything.' },
        from: { type: 'string', description: `Earliest day to search, ${ISO_DATE}. Omit for the last month.` },
        to: { type: 'string', description: `Latest day to search, ${ISO_DATE}. Omit for today.` },
        limit: { type: 'number', description: 'How many meals to return, up to 40. Default 15.' },
      },
      required: [],
    },
  },
  {
    name: 'nutrient_report',
    description:
      'Averages across a date range against their targets, including the vitamins and minerals Squish tracks: iron, calcium, vitamin D, B12, folate and vitamin C. ' +
      'Use this for "am I getting enough X", "what am I short of", or any question about how a stretch of time compares with what they are aiming for. ' +
      'Figures only cover meals that reported them, and the answer says how many did.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: `First day, ${ISO_DATE}` },
        to: { type: 'string', description: `Last day inclusive, ${ISO_DATE}` },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'remember',
    description:
      'Save something about this person that should shape every future conversation: what they will not eat, an allergy, a condition they have mentioned, what they are training for, a preference they have stated. ' +
      'Use it the moment they tell you something worth keeping, and tell them you have. ' +
      'One fact per note, in your own words, written so it still makes sense months later. ' +
      'Do not save passing details — what they had for lunch is in the diary already.',
    input_schema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'The fact to keep, one short sentence.' },
      },
      required: ['note'],
    },
  },
  {
    name: 'forget',
    description:
      'Delete something you were remembering, when they say it is wrong or no longer true. The id comes from the list of what you already know.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The id of the note to remove.' },
      },
      required: ['id'],
    },
  },
];

/** The names the browser is allowed to be asked to run. */
export const TOOL_NAMES = new Set(NUTRITIONIST_TOOLS.map((tool) => tool.name));

/** A call on its way to the browser. */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Its answer on the way back. */
export interface ToolAnswer {
  id: string;
  content: string;
  isError?: boolean;
}
