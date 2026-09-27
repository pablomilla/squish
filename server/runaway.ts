/**
 * Telling when a model is stuck: an answer that ends in the same thing over
 * and over. Used by the Gemini stream to stop one early (server/gemini.ts),
 * and to say what went wrong when an answer was cut off (server/claude.ts).
 */

/**
 * What an answer is stuck repeating at its end, if it is: one character
 * ("0000…") or a short pattern ("123456789123456789…"), over at least 200
 * characters — longer than anything honest in an answer, where indentation is
 * a few spaces and a number a few digits. Null when it is not.
 */
export function repeating(text: string, over = 200): string | null {
  for (let period = 1; period <= 20; period++) {
    if (text.length < over + period) break;
    const tail = text.slice(-(over + period));
    if (tail.slice(period) === tail.slice(0, -period)) return tail.slice(-period);
  }
  return null;
}
