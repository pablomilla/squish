/**
 * Turn off an admin's two-step sign-in, for a lost phone with no recovery
 * codes left.
 *
 * A script rather than a button on purpose. Everything that can reach a
 * button is exactly what the second step is there to stop; somebody who can
 * open the server's shell has already proved something a stolen password
 * cannot.
 *
 *   npm run reset-2fa -- you@example.com
 *
 * Next time they open the dashboard they are asked to set it up again, with
 * their password and a fresh QR code. It needs DATABASE_URL, which on Render
 * means running it from the web service's Shell tab.
 */
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { normaliseEmail } from '../server/accounts';
import { resetTwoFactor } from '../server/twofactor';

const [who] = process.argv.slice(2);

if (!who) {
  console.error('Usage:\n  npm run reset-2fa -- <email>');
  process.exit(1);
}
if (!hasDatabase()) {
  console.error('\nNo DATABASE_URL, so there is nothing to reset.\n');
  process.exit(1);
}

await migrate();
const email = normaliseEmail(who);
const rows = await query<{ id: string; email: string }>('select id, email from accounts where email = $1', [email]);

if (!rows.length) {
  console.error(`\nNo account on ${email}.\n`);
  await closeDatabase();
  process.exit(1);
}

await resetTwoFactor(rows[0].id);
await query('insert into admin_actions (admin, action, subject, detail) values ($1, $2, $3, $4)', [
  'server shell',
  'reset 2FA',
  rows[0].email,
  null,
]);
console.log(`\nTwo-step sign-in is off for ${rows[0].email}. They will be asked to set it up again.\n`);
await closeDatabase();
