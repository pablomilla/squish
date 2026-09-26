import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The password box.
 *
 * Read as source rather than rendered, because there is no DOM under
 * `node --test` and the things worth protecting here are all statements about
 * the code: that the toggle cannot submit the form it sits in, that it says
 * which state it is in rather than only showing a picture, and that nowhere
 * in the app went back to a bare password input without a way to see it.
 */
const field = readFileSync('src/components/PasswordField.tsx', 'utf8');

test('the toggle cannot submit the form it sits in', () => {
  // A button inside a form defaults to type="submit". Without this, tapping
  // the eye on the create-account form tries to create the account.
  const button = field.slice(field.indexOf('<button'), field.indexOf('</button>'));
  assert.match(button, /type="button"/, 'the eye would submit the form');
});

test('it says which state it is in, not just which picture it shows', () => {
  assert.match(field, /aria-label=\{shown \? t\('Hide password'\) : t\('Show password'\)\}/);
  assert.match(field, /aria-pressed=\{shown\}/, 'a screen reader should not have to press it to find out');
});

test('it starts hidden, and nothing remembers otherwise', () => {
  assert.match(field, /useState\(false\)/);
  assert.ok(!/localStorage|sessionStorage/.test(field), 'the choice must not outlive the form — the next time might be on a train');
});

test('revealing keeps autoComplete, so password managers still recognise it', () => {
  // The type flips to `text`; if the hint went with it, a manager would stop
  // offering to save what somebody just typed.
  assert.match(field, /autoComplete=\{autoComplete\}/);
  assert.match(field, /type=\{shown \? 'text' : 'password'\}/);
});

test('every password in the app goes through it', () => {
  // The whole point of one component. This fails the day somebody adds a
  // seventh form with a bare input and no way to see what was typed.
  const roots = ['src/components', 'src/screens'];
  const offenders: string[] = [];

  for (const root of roots) {
    for (const name of readdirSync(root)) {
      if (!name.endsWith('.tsx') || name === 'PasswordField.tsx') continue;
      const source = readFileSync(join(root, name), 'utf8');
      if (/type="password"/.test(source)) offenders.push(join(root, name));
    }
  }

  assert.deepEqual(offenders, [], `these have a password box with no way to see it: ${offenders.join(', ')}`);
});
