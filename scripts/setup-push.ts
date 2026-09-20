/**
 * Generate the keypair meal reminders need.
 *
 * Web push signs every message with a VAPID key so the push services —
 * Google's, Apple's, Mozilla's — can tell who sent it. The pair is generated
 * once and lives in the environment; the public half goes out to every
 * browser that subscribes, the private half never leaves the server.
 *
 * Run it once, paste the output into .env or your host's environment, restart.
 */
import webpush from 'web-push';

const existing = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY;

if (existing && !process.argv.includes('--force')) {
  console.log('🔑  VAPID keys are already set in this environment.');
  console.log('    Reminders should be working. Pass --force to generate a new pair.');
  console.log('\n    Generating a new pair invalidates every existing subscription,');
  console.log('    so everyone already getting reminders would have to turn them on again.');
  process.exit(0);
}

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log('🔑  A new keypair for meal reminders.\n');
console.log('Add these to your .env, or to the environment on your host:\n');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
console.log('\nThe subject is a contact address the push services use if something');
console.log('goes wrong at their end. A mailto: or a URL, and yours rather than a user’s.\n');
console.log('Two more things worth knowing:\n');
console.log('  · Subscriptions are kept in .data/push-subscriptions.json by default');
console.log('    (SQUISH_PUSH_STORE moves it). On a host with an ephemeral disk —');
console.log('    which includes Render without a persistent disk attached — that');
console.log('    file is lost on every deploy and everyone has to opt in again.\n');
console.log('  · The private key is a credential. Do not commit it.');
