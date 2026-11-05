import { pgTestDatabaseIdentifier } from './pg-test-config.ts';

// All test entry points acquire this key in the same ff_test database, including Docker's ff target.
export const PG_TEST_LEASE_KEY = 7291090;
export interface PgTestLeaseClient { query(sql: string, values?: unknown[]): Promise<{ rows: any[] }> }
export class PgTestLeaseError extends Error {
  readonly code: 'BUSY' | 'ACTIVE_DATABASES';
  constructor(code: 'BUSY' | 'ACTIVE_DATABASES') {
    super(code === 'BUSY' ? '다른 PostgreSQL 시험이 실행 중입니다. 끝난 뒤 다시 실행하세요.' : '사용 중인 PostgreSQL 시험 DB가 있어 정리를 중단했습니다. 해당 시험이 끝난 뒤 다시 실행하세요.');
    this.code = code;
  }
}

/** The session stays connected through the entire child run. OS/session termination also releases its advisory lock. */
export async function withPgTestLease<T>(client: PgTestLeaseClient, action: () => Promise<T>): Promise<T> {
  const result = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [PG_TEST_LEASE_KEY]);
  if (result.rows[0]?.locked !== true) throw new PgTestLeaseError('BUSY');
  try { return await action(); }
  finally { await client.query('SELECT pg_advisory_unlock($1) AS unlocked', [PG_TEST_LEASE_KEY]); }
}

/** No FORCE: even an orphaned runner whose parent lost its lease cannot have live databases deleted. */
export async function cleanupInactivePgTestDatabases(client: PgTestLeaseClient): Promise<number> {
  const active = await client.query("SELECT DISTINCT datname FROM pg_stat_activity WHERE (datname LIKE 'ff\\_t\\_%' OR datname LIKE 'ff\\_tpl\\_%') AND pid <> pg_backend_pid()");
  if (active.rows.length) throw new PgTestLeaseError('ACTIVE_DATABASES');
  const stale = await client.query("SELECT datname FROM pg_database WHERE datname LIKE 'ff\\_t\\_%' OR datname LIKE 'ff\\_tpl\\_%'");
  // Validate the full set before the first mutation.
  const identifiers = stale.rows.map((row) => pgTestDatabaseIdentifier(row.datname));
  for (const identifier of identifiers) {
    await client.query(`ALTER DATABASE ${identifier} IS_TEMPLATE false`);
    await client.query(`DROP DATABASE IF EXISTS ${identifier}`);
  }
  return identifiers.length;
}
