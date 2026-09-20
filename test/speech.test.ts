import assert from 'node:assert/strict';
import { test } from 'node:test';
import { speechErrorMessage, speechSupported, startDictation } from '../src/lib/speech';

/**
 * Node has no Web Speech API, which is the same situation as Firefox and as an
 * older iPhone — so this file is mostly about the app staying upright without
 * one.
 */

test('a browser without speech recognition says so rather than throwing', () => {
  assert.equal(speechSupported(), false);
  assert.equal(
    startDictation({ onChange: () => {}, onEnd: () => {}, onError: () => {} }),
    null,
    'callers treat null as "not on offer" and carry on',
  );
});

test('the errors are in words somebody can act on', () => {
  assert.match(speechErrorMessage('not-allowed'), /permission/i);
  assert.match(speechErrorMessage('audio-capture'), /microphone/i);
  assert.match(speechErrorMessage('network'), /reach/i);
  assert.ok(!speechErrorMessage('bananas').includes('bananas'), 'an unknown code is not shown raw');
  for (const code of ['not-allowed', 'no-speech', 'audio-capture', 'network', 'bananas']) {
    assert.ok(speechErrorMessage(code).length > 10, `${code} deserves a real sentence`);
  }
});

test('it is offered where the browser has it', () => {
  const stub = class {
    lang = ''; continuous = false; interimResults = false; maxAlternatives = 0;
    onresult = null; onerror = null;
    onend: (() => void) | null = null;
    start() {} stop() { this.onend?.(); } abort() {}
  };
  (globalThis as Record<string, unknown>).SpeechRecognition = stub;
  try {
    assert.equal(speechSupported(), true);
    const session = startDictation({ onChange: () => {}, onEnd: () => {}, onError: () => {} });
    assert.ok(session, 'and starts');
    session?.stop();
  } finally {
    delete (globalThis as Record<string, unknown>).SpeechRecognition;
  }
});

test('the webkit-prefixed name counts too — that is the one on iPhones', () => {
  const stub = class {
    lang = ''; continuous = false; interimResults = false; maxAlternatives = 0;
    onresult = null; onerror = null; onend = null;
    start() {} stop() {} abort() {}
  };
  (globalThis as Record<string, unknown>).webkitSpeechRecognition = stub;
  try {
    assert.equal(speechSupported(), true);
  } finally {
    delete (globalThis as Record<string, unknown>).webkitSpeechRecognition;
  }
});

test('what it heard is handed over in one piece when it ends', () => {
  let ended: string | null = null;
  // One object, handed back by the constructor, so the test can drive the
  // handlers the browser would have called.
  const made = {
    lang: '', continuous: false, interimResults: false, maxAlternatives: 0,
    onresult: null as ((e: unknown) => void) | null,
    onerror: null as ((e: unknown) => void) | null,
    onend: null as (() => void) | null,
    start() {},
    stop() { made.onend?.(); },
    abort() {},
  };
  const stub = function Stub() { return made; } as unknown as new () => typeof made;
  (globalThis as Record<string, unknown>).SpeechRecognition = stub;
  try {
    const seen: string[] = [];
    const session = startDictation({
      onChange: ({ final, interim }) => seen.push([final, interim].filter(Boolean).join('|')),
      onEnd: (final) => { ended = final; },
      onError: () => {},
    });

    made.onresult?.({
      resultIndex: 0,
      results: { length: 2, 0: { length: 1, isFinal: true, 0: { transcript: 'two eggs ' } }, 1: { length: 1, isFinal: false, 0: { transcript: 'and toast' } } },
    });

    assert.deepEqual(seen, ['two eggs|and toast'], 'settled words and the ones still moving, kept apart');
    session?.stop();
    assert.equal(ended, 'two eggs', 'only what was settled survives the end');
  } finally {
    delete (globalThis as Record<string, unknown>).SpeechRecognition;
  }
});


test('a stop that never comes back does not leave the microphone reading as live', async () => {
  // A recogniser whose stop() quietly does nothing — the failure that left the
  // button lit and the session open until the 45-second cap.
  const stub = class {
    lang = ''; continuous = false; interimResults = false; maxAlternatives = 0;
    onresult = null; onerror = null;
    onend: (() => void) | null = null;
    start() {} stop() {} abort() {}
  };
  (globalThis as Record<string, unknown>).SpeechRecognition = stub;
  try {
    let ended = false;
    const session = startDictation({ onChange: () => {}, onEnd: () => { ended = true; }, onError: () => {} });
    session?.stop();
    assert.equal(ended, false, 'it gives the real event a chance first');
    await new Promise((resolve) => setTimeout(resolve, 1700));
    assert.equal(ended, true, 'and gives up on it shortly after');
  } finally {
    delete (globalThis as Record<string, unknown>).SpeechRecognition;
  }
});
