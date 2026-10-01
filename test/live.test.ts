import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import express from 'express';
import { splitEvents } from '../src/lib/events';
import { closeDatabase, hasDatabase, query } from '../server/db';
import { announceDiary, liveCount, stopWatching, watchDiary } from '../server/live';

/**
 * Being told the moment another device saves: the server's side, over a real
 * connection, read the way the app reads it.
 */

const app = express();
app.get('/live/:owner', (req, res) => watchDiary(req.params.owner, 3, req, res));
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

after(async () => {
  await stopWatching();
  server.closeAllConnections();
  server.close();
  if (hasDatabase()) await closeDatabase();
});

/** A device listening: every version it is told, as it is told it. */
function listener(owner: string) {
  const heard: number[] = [];
  const stop = new AbortController();
  const done = (async () => {
    try {
      const response = await fetch(`${base}/live/${owner}`, { signal: stop.signal });
      assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return 'ended';
        const { events, rest } = splitEvents(buffer + decoder.decode(value, { stream: true }));
        buffer = rest;
        for (const e of events) if (e.event === 'version') heard.push(JSON.parse(e.data).version);
      }
    } catch {
      return 'aborted';
    }
  })();
  return { heard, close: () => stop.abort(), done };
}

async function until(ok: () => boolean, what: string, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) assert.fail(`never: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('events split where they end, comments skipped, the unfinished kept for later', () => {
  const { events, rest } = splitEvents('event: version\ndata: {"version":4}\n\n: still here\n\nevent: version\ndata: {"vers');
  assert.deepEqual(events, [{ event: 'version', data: '{"version":4}' }]);
  assert.equal(rest, 'event: version\ndata: {"vers');
  assert.deepEqual(splitEvents('data: a\r\ndata: b\r\n\r\n').events, [{ event: 'message', data: 'a\nb' }]);
});

test('told the version on arrival, then each save of the same diary, and nobody else’s', async () => {
  const phone = listener('sam');
  const ipad = listener('sam');
  const stranger = listener('alex');
  await until(() => phone.heard.length && ipad.heard.length && stranger.heard.length ? true : false, 'all three connected');
  assert.deepEqual(phone.heard, [3], 'the version as it is, straight away');

  await announceDiary('sam', 4);
  await until(() => phone.heard.length === 2 && ipad.heard.length === 2, 'both of Sam’s told');
  assert.deepEqual(ipad.heard, [3, 4]);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(stranger.heard, [3], 'another person’s diary says nothing here');

  phone.close();
  ipad.close();
  stranger.close();
  await until(() => liveCount() === 0, 'closed lines let go');
});

test('another instance’s save arrives through the database', { skip: !hasDatabase() && 'needs DATABASE_URL' }, async () => {
  const phone = listener('jo');
  await until(() => phone.heard.length === 1, 'connected');
  // What announceDiary on another instance sends. Repeated until this instance is listening, which it starts doing on the first line.
  let version = 10;
  await until(
    () => {
      if (phone.heard.at(-1)! >= 10) return true;
      void query('select pg_notify($1, $2)', ['squish_diary', JSON.stringify({ owner: 'jo', version: version++ })]);
      return false;
    },
    'told of a save made elsewhere',
  );
  phone.close();
  await until(() => liveCount() === 0, 'closed');
});

test('one person’s devices are capped: the oldest line goes', async () => {
  const lines = Array.from({ length: 11 }, () => listener('lots'));
  await until(() => lines.every((l) => l.heard.length), 'all connected');
  assert.equal(await lines[0].done, 'ended', 'the first was closed by the server');
  assert.equal(liveCount(), 10);
  for (const l of lines) l.close();
  await until(() => liveCount() === 0, 'closed');
});

test('shutting down ends every line, so the apps reconnect elsewhere', async () => {
  const phone = listener('kim');
  await until(() => phone.heard.length === 1, 'connected');
  await stopWatching();
  assert.equal(await phone.done, 'ended');
  assert.equal(liveCount(), 0);
});
