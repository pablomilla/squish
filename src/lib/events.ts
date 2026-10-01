/** Reading server-sent events by hand, for src/lib/backup.ts: pure, so it can be tested anywhere. */

/**
 * Cues in a stream of server-sent events: each finished event's name and
 * data, and what is left over until the rest of it arrives. Comments (the
 * server's "still here") are not events.
 */
export function splitEvents(buffer: string): { events: { event: string; data: string }[]; rest: string } {
  const blocks = buffer.replace(/\r\n?/g, '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: { event: string; data: string }[] = [];
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}
