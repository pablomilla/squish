/**
 * Squish's database, and its absence.
 *
 * The server has been stateless since it was written, and most of what it does
 * still needs nothing: analysing a photo, answering a question, reading a
 * barcode. Identity, backup and accounts need somewhere to put things, and
 * that is what this is.
 *
 * The absence matters as much as the presence. With no `DATABASE_URL` every
 * function here answers "not available" and the app behaves exactly as it did
 * before any of this existed — diary in the browser, no accounts, no backup.
 * That is not a degraded mode to apologise for; it is how Squish runs on
 * somebody's laptop, and it is what stops a database outage taking the whole
 * app down with it.
 */
import { Pool, type PoolClient } from 'pg';

const URL = process.env.DATABASE_URL?.trim();

let pool: Pool | null = null;

/** True when there is somewhere to write. Checked before anything is offered. */
export const hasDatabase = (): boolean => Boolean(URL);

function getPool(): Pool {
  if (!URL) throw new Error('No DATABASE_URL — nothing here should have been called.');
  pool ??= new Pool({
    connectionString: URL,
    // Render's managed Postgres presents a certificate this does not have a
    // root for. The connection is still encrypted; what is not checked is who
    // is on the other end, which is acceptable inside their network and would
    // not be across the open internet.
    ssl: URL.includes('localhost') || URL.includes('/tmp') ? undefined : { rejectUnauthorized: false },
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return pool;
}

export async function query<T extends Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query(text, values);
  return result.rows as T[];
}

/** A connection of your own, for the length of one job. */
async function withClient<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await body(client);
  } finally {
    client.release();
  }
}

/** Several statements that must all happen, or none of them. */
export async function transaction<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await body(client);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The schema, applied in order, once each.
 *
 * Numbered and recorded rather than `create table if not exists` alone,
 * because the second migration is always the one that alters something and
 * "if not exists" has no opinion about a column that changed shape.
 */
const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
      create table accounts (
        id            text primary key,
        email         text not null unique,
        password_hash text not null,
        created_at    timestamptz not null default now()
      );

      -- A device is a browser or a phone. It exists before any account does,
      -- and it keeps working if the account is deleted — the diary belongs to
      -- whoever is holding the device either way.
      create table devices (
        id           text primary key,
        token_hash   text not null unique,
        account_id   text references accounts(id) on delete set null,
        created_at   timestamptz not null default now(),
        last_seen_at timestamptz not null default now()
      );

      -- One diary per owner. The owner is an account where there is one and a
      -- device where there is not, which is what lets somebody use Squish for
      -- a month and then sign up without losing anything.
      create table diaries (
        owner_id   text primary key,
        state      jsonb not null,
        version    bigint not null default 1,
        updated_at timestamptz not null default now()
      );

      -- What each device has spent, by day, so an allowance can be counted and
      -- a rate limit can be about a person rather than about an IP address
      -- shared by everybody on the same mobile network.
      create table usage (
        device_id text not null references devices(id) on delete cascade,
        day       date not null,
        kind      text not null,
        count     integer not null default 0,
        primary key (device_id, day, kind)
      );

      create index devices_account on devices(account_id);
    `,
  },
  {
    id: 2,
    sql: `
      -- A password reset in flight. The token is stored hashed, the same way
      -- the device token is: it is a bearer credential for the two hours it
      -- lives, and a database somebody has read should not hand them anybody's
      -- account.
      create table resets (
        token_hash text primary key,
        account_id text not null references accounts(id) on delete cascade,
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      );

      create index resets_account on resets(account_id);
    `,
  },
  {
    id: 3,
    sql: `
      -- When Squish Plus runs out for this account. Null is the free tier,
      -- and so is a date in the past — which is the whole point of storing an
      -- expiry rather than a boolean: a subscription that lapses has to stop
      -- being true on its own, without anything having to remember to run.
      --
      -- It is also what a comped tester looks like: the same column, a date
      -- far enough away not to matter.
      alter table accounts add column plus_until timestamptz;

      create index accounts_plus on accounts(plus_until) where plus_until is not null;
    `,
  },
  {
    id: 4,
    sql: `
      -- Who has redeemed which invite code.
      --
      -- The codes themselves are not in here: they are an environment
      -- variable, so that handing Plus to a tester is editing one field in a
      -- dashboard rather than running a script against the database. What is
      -- worth keeping is the redemptions — so a code cannot be used twice by
      -- the same account, and so it is possible to see who took one up.
      create table invite_uses (
        code       text not null,
        account_id text not null references accounts(id) on delete cascade,
        days       integer not null,
        used_at    timestamptz not null default now(),
        primary key (code, account_id)
      );

      create index invite_uses_account on invite_uses(account_id);
    `,
  },
  {
    id: 5,
    sql: `
      -- What each day's calls actually cost.
      --
      -- The price of every call has been worked out since the benchmark was
      -- written, and then thrown away into a log line. Keeping it is what
      -- turns the costings in docs/monetisation.md from a guess into a
      -- measurement, and it is the only way to answer "is Plus priced right"
      -- with anything other than an opinion.
      --
      -- Numeric rather than a float: these are fractions of a cent added up
      -- thousands of times, and binary floating point drifts.
      alter table usage add column cost_usd numeric(12, 6) not null default 0;

      -- What an admin did, because granting somebody a paid tier is the sort
      -- of thing you want a record of when it is later disputed.
      create table admin_actions (
        id         bigserial primary key,
        admin      text not null,
        action     text not null,
        subject    text,
        detail     text,
        at         timestamptz not null default now()
      );

      create index admin_actions_at on admin_actions(at desc);
    `,
  },
  {
    id: 6,
    sql: `
      -- Invite codes, which used to be an environment variable.
      --
      -- Moved into the database so they can be made and retired from the
      -- dashboard rather than by editing a deploy. That also buys the things
      -- an environment variable could never have: a limit on how many times
      -- one can be used, an expiry, a note saying who it was for, and a count
      -- of how many people took it up.
      --
      -- Null means no limit, for both uses and expiry. A disabled code stays
      -- so its redemptions still make sense in the record.
      create table invites (
        code       text primary key,
        days       integer not null,
        uses_left  integer,
        note       text,
        expires_at timestamptz,
        disabled   boolean not null default false,
        created_by text,
        created_at timestamptz not null default now()
      );
    `,
  },
  {
    id: 7,
    sql: `
      -- Whether the address on an account has been shown to belong to whoever
      -- made it. Null until a link sent to it is followed.
      --
      -- It matters for one thing above all: security notices only go to a
      -- confirmed address. Otherwise anybody could sign up as a stranger and
      -- have Squish send them mail about an account they never made.
      alter table accounts add column email_verified_at timestamptz;

      -- Links sent to confirm an address. Hashed, like reset tokens, and kept
      -- until they expire rather than deleted on first use — mail scanners
      -- follow links before people do, and somebody clicking theirs after a
      -- scanner got there first should see "confirmed", not "expired".
      create table verifications (
        token_hash text primary key,
        account_id text not null references accounts(id) on delete cascade,
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      );

      create index verifications_account on verifications(account_id);
    `,
  },
];

let ready: Promise<void> | null = null;

/**
 * An arbitrary constant, agreed only with ourselves.
 *
 * Postgres advisory locks are a namespace of integers with no meaning beyond
 * everybody using the same one. This is Squish's number for "somebody is
 * migrating".
 */
const MIGRATION_LOCK = 8_273_461;

/**
 * Bring the schema up to date, once, however many instances are starting.
 *
 * The lock is the whole point. Two processes booting together — which is
 * exactly what happens the moment a host is allowed to add an instance — both
 * read an empty `migrations` table, both run `create table accounts`, and the
 * loser dies on a duplicate-object error. Measured, not imagined: two
 * processes against a fresh database, one up, one refusing to start.
 *
 * So one holds the lock and the rest wait for it. What they find when they get
 * in is a table that says the work is done, which is why the applied set is
 * read inside the lock and not before it.
 */
async function apply(): Promise<void> {
  await withClient(async (client) => {
    // Taken before anything is created, including the ledger itself. An
    // advisory lock needs no table to exist, and `create table if not exists`
    // is NOT atomic against a concurrent create — two instances running it
    // together still collide in the system catalogue, which is precisely how
    // this was found after the first attempt at a fix.
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    try {
      await client.query(
        'create table if not exists migrations (id integer primary key, applied_at timestamptz not null default now())',
      );
      const rows = await client.query<{ id: number }>('select id from migrations');
      const done = new Set(rows.rows.map((row) => row.id));

      for (const step of MIGRATIONS) {
        if (done.has(step.id)) continue;
        try {
          await client.query('begin');
          await client.query(step.sql);
          await client.query('insert into migrations (id) values ($1)', [step.id]);
          await client.query('commit');
        } catch (error) {
          await client.query('rollback');
          throw error;
        }
        console.log(`[squish] database migration ${step.id} applied`);
      }
    } finally {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    }
  });
}

/** Applied once per process, on the first request that needs it. */
export function migrate(): Promise<void> {
  ready ??= apply().catch((error: unknown) => {
    // Forgotten rather than remembered. A cached rejection would be handed to
    // every later request too, so one unlucky moment at startup — a database
    // still waking up, a migration that raced — left the instance refusing to
    // serve anything for as long as it ran. Clearing it means the next request
    // tries again.
    ready = null;
    throw error;
  });
  return ready;
}

/** For tests, which want a pool that does not outlive them. */
export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = null;
  ready = null;
}
