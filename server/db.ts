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
];

let ready: Promise<void> | null = null;

/** Applied once per process, on the first request that needs it. */
export function migrate(): Promise<void> {
  ready ??= (async () => {
    await query('create table if not exists migrations (id integer primary key, applied_at timestamptz not null default now())');
    const done = new Set((await query<{ id: number }>('select id from migrations')).map((row) => row.id));

    for (const step of MIGRATIONS) {
      if (done.has(step.id)) continue;
      await transaction(async (client) => {
        await client.query(step.sql);
        await client.query('insert into migrations (id) values ($1)', [step.id]);
      });
      console.log(`[squish] database migration ${step.id} applied`);
    }
  })();
  return ready;
}

/** For tests, which want a pool that does not outlive them. */
export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = null;
  ready = null;
}
