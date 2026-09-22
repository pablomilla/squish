/**
 * Give somebody Squish Plus, or take it away.
 *
 * For testers, and for the handful of times a real subscriber needs putting
 * right by hand. It is a script rather than an admin endpoint on purpose: an
 * HTTP route that hands out paid access is a route somebody will eventually
 * find, and the number of times this needs running does not justify building
 * and then defending one.
 *
 *   npm run grant -- someone@example.com            # a year
 *   npm run grant -- someone@example.com 30         # thirty days
 *   npm run grant -- someone@example.com off        # back to free
 *   npm run grant -- --list                         # everyone on Plus
 *
 * It needs DATABASE_URL, which on Render means running it from the service's
 * shell, or locally with the External Database URL in the environment.
 */
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { normaliseEmail } from '../server/accounts';
import { PLUS } from '../src/lib/subscription';

const [who, howLong] = process.argv.slice(2);

function usage(problem?: string): never {
  if (problem) console.error(`\n${problem}\n`);
  console.error('Usage:');
  console.error('  npm run grant -- <email> [days|off]   give or remove ' + PLUS);
  console.error('  npm run grant -- --list               who is on it now');
  process.exit(problem ? 1 : 0);
}

if (!hasDatabase()) usage('No DATABASE_URL, so there is no account to grant anything to.');
if (!who) usage();

await migrate();

if (who === '--list') {
  const rows = await query<{ email: string; plus_until: Date }>(
    'select email, plus_until from accounts where plus_until > now() order by plus_until',
  );
  if (!rows.length) console.log(`Nobody is on ${PLUS}.`);
  else {
    console.log(`On ${PLUS}:`);
    for (const row of rows) console.log(`  ${row.email.padEnd(34)} until ${row.plus_until.toISOString().slice(0, 10)}`);
  }
  await closeDatabase();
  process.exit(0);
}

const email = normaliseEmail(who);
const off = howLong === 'off';
const days = off ? 0 : Number(howLong ?? 365);

if (!off && (!Number.isFinite(days) || days <= 0)) usage(`"${howLong}" is not a number of days.`);

const rows = await query<{ email: string; plus_until: Date | null }>(
  off
    ? 'update accounts set plus_until = null where email = $1 returning email, plus_until'
    : `update accounts set plus_until = now() + ($2 || ' days')::interval where email = $1 returning email, plus_until`,
  off ? [email] : [email, String(days)],
);

if (!rows.length) {
  // Said plainly rather than created. An account appearing because somebody
  // mistyped an address is worse than being told to check the address.
  console.error(`\nNo account on ${email}. They need to sign up in the app first.\n`);
  await closeDatabase();
  process.exit(1);
}

const until = rows[0].plus_until;
console.log(
  until
    ? `\n${rows[0].email} is on ${PLUS} until ${until.toISOString().slice(0, 10)}.\n`
    : `\n${rows[0].email} is back on the free plan.\n`,
);

await closeDatabase();
