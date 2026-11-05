import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanupInactivePgTestDatabases, PG_TEST_LEASE_KEY, PgTestLeaseError, withPgTestLease } from './pg-test-lease.ts';

const fake = (locked: boolean, active: string[] = [], databases = ['ff_t_123', 'ff_tpl_a"b']) => {
  const queries: { sql: string; values?: unknown[] }[] = [];
  return { queries, async query(sql: string, values?: unknown[]) {
    queries.push({ sql, values });
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked }] };
    if (sql.includes('pg_stat_activity')) return { rows: active.map((datname) => ({ datname })) };
    if (sql.includes('FROM pg_database')) return { rows: databases.map((datname) => ({ datname })) };
    return { rows: [{ unlocked: true }] };
  } };
};
test('이미 잠겼으면 cleanup/action/해제를 전혀 호출하지 않는다', async () => {
  const client = fake(false);
  let entered = false;
  await assert.rejects(() => withPgTestLease(client, async () => { entered = true; await cleanupInactivePgTestDatabases(client); }), (e: PgTestLeaseError) => e.code === 'BUSY');
  assert.equal(entered, false);
  assert.equal(client.queries.length, 1);
  assert.deepEqual(client.queries[0].values, [PG_TEST_LEASE_KEY]);
});
test('action 전체를 잠금으로 감싸고 성공·실패 모두 마지막에 해제한다', async () => {
  for (const fail of [false, true]) {
    const client = fake(true);
    const run = () => withPgTestLease(client, async () => {
      assert.equal(client.queries.length, 1);
      await client.query('SELECT child_finished');
      if (fail) throw new Error('injected child failure');
      return 42;
    });
    if (fail) await assert.rejects(run, /injected child failure/); else assert.equal(await run(), 42);
    assert.match(client.queries.at(-1)!.sql, /pg_advisory_unlock/);
    assert.deepEqual(client.queries.at(-1)!.values, [PG_TEST_LEASE_KEY]);
  }
});
test('활성 시험 DB가 있으면 ALTER/DROP 전에 멈춘다', async () => {
  const client = fake(true, ['ff_t_another_runner']);
  await assert.rejects(() => withPgTestLease(client, () => cleanupInactivePgTestDatabases(client)), (e: PgTestLeaseError) => e.code === 'ACTIVE_DATABASES');
  assert.equal(client.queries.some((q) => /ALTER|DROP/.test(q.sql)), false);
});
test('검증한 시험 식별자만 정리하고 FORCE를 사용하지 않는다', async () => {
  const client = fake(true);
  assert.equal(await withPgTestLease(client, () => cleanupInactivePgTestDatabases(client)), 2);
  assert.ok(client.queries.some((q) => q.sql === 'DROP DATABASE IF EXISTS "ff_tpl_a""b"'));
  assert.equal(client.queries.some((q) => q.sql.includes('FORCE')), false);
  const invalid = fake(true, [], ['ff_t_ok', 'customer_database']);
  await assert.rejects(() => withPgTestLease(invalid, () => cleanupInactivePgTestDatabases(invalid)));
  assert.equal(invalid.queries.some((q) => /ALTER|DROP/.test(q.sql)), false);
});
