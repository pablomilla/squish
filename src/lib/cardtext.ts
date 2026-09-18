/**
 * Fitting words into a fixed picture.
 *
 * Kept apart from the drawing so it can be tested without a canvas: the caller
 * supplies the measuring, which on a canvas is `ctx.measureText`.
 */

/** How wide a run of text comes out, in the font currently set. */
export type Measure = (text: string) => number;

/**
 * Break on spaces so no line runs past `maxWidth`. A single word too long to
 * fit is left alone rather than broken mid-word — better a slightly wide line
 * than "streak" split across two.
 */
export function wrap(text: string, maxWidth: number, measure: Measure): string[] {
  if (measure(text) <= maxWidth) return [text];

  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** At most `max` lines, the last one trailing off if there was more. */
export function limit(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1].replace(/[,.;:]$/, '')}…`;
  return kept;
}
