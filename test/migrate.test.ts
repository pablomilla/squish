import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { test, before, after } from 'node:test';
import { closeDatabase, hasDatabase, query } from '../server/db';

const run = promisify(execFile);

/**
 * Starting more than one instance at once.
 *
 * A host that is allowed to scale adds instances, and instances boot together.
 * Both read an empty `migrations` table, both run `create table accounts`, and
 * the loser dies on a duplicate object — and because the failed promise was
 * cached, it went on refusing every later request too. One instance,
 * permanently broken, from one unlucky moment.
 *
 * This has to be child processes. Within one process the memo in `migrate`
 * means the second caller gets the first one's promise and there is no race to
 * find, which is exactly why the bug survived being reasoned about.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

const TEST_DB = 'squish_migrate_race';

/** The same connection string, pointed at another database on the same server. */
function urlFor(database: string): string {
  // Written as a swap of the path segment rather than with URL(), because the
  // socket form — postgresql://squish@/squish?host=/tmp/pgsock — has no host
  // in the authority and URL() will not parse it.
  return process.env.DATABASE_URL!.replace(/^(postgres(?:ql)?:\/\/[^/]*\/)[^?]*/, `$1${database}`);
}

before(async () => {
  if (!enabled) return;
  // A database of its own: the point is a schema that does not exist yet.
  await query(`drop database if exists ${TEST_DB}`);
  await query(`create database ${TEST_DB}`);
});

after(async () => {
  if (!enabled) return;
  await query(`drop database if exists ${TEST_DB}`);
  await closeDatabase();
});

when('four instances starting at once all come up, and migrate the schema once', async () => {
  const boot = () =>
    run(
      'npx',
      // A dynamic import of an absolute path: `tsx -e` does not resolve a
      // relative specifier against the working directory, and evaluates as
      // CJS, where a top-level await is a syntax error.
      [
        'tsx',
        '-e',
        `import(${JSON.stringify(resolve(process.cwd(), 'server/db.ts'))})` +
          `.then((m) => m.migrate().then(() => m.closeDatabase()))` +
          `.catch((e) => { console.error(e); process.exit(1); })`,
      ],
      { env: { ...process.env, DATABASE_URL: urlFor(TEST_DB) }, cwd: process.cwd() },
    );

  const results = await Promise.allSettled([boot(), boot(), boot(), boot()]);
  const failed = results.filter((r) => r.status === 'rejected');
  assert.equal(
    failed.length,
    0,
    `an instance refused to start: ${failed.map((f) => String((f as PromiseRejectedResult).reason).slice(0, 200)).join(' / ')}`,
  );
});
