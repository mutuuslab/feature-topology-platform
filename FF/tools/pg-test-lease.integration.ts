// Explicit native-cluster proof; no database/schema is created, altered or dropped. Supply the normal local ff_test URL through the environment.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pgTestConfig } from './pg-test-config.ts';
import { PgTestLeaseError, withPgTestLease } from './pg-test-lease.ts';
const config = pgTestConfig(process.env);
if (!config.native) throw new Error('분리된 로컬 ff_test 연결을 먼저 설정하세요.');
const { Client } = createRequire(import.meta.url)('pg');
const first = new Client({ connectionString: config.url, connectionTimeoutMillis: 3000 });
const second = new Client({ connectionString: config.url, connectionTimeoutMillis: 3000 });
try {
  await first.connect(); await second.connect();
  let forbidden = false;
  await withPgTestLease(first, async () => {
    await assert.rejects(() => withPgTestLease(second, async () => { forbidden = true; }), (e: PgTestLeaseError) => e.code === 'BUSY');
    assert.equal(forbidden, false);
  });
  let acquired = false;
  await withPgTestLease(second, async () => { acquired = true; });
  assert.equal(acquired, true);
  // A lost/terminated owner session must release the server lock even without the explicit unlock query.
  await assert.rejects(() => withPgTestLease(first, async () => { await first.end(); throw new Error('owner session ended'); }));
  let recovered = false;
  await withPgTestLease(second, async () => { recovered = true; });
  assert.equal(recovered, true);
  console.log('Native PG lease proof passed: contender rejected, finally/disconnect released, next runner acquired; no DDL.');
} catch {
  console.error('Native PG lease proof failed. 연결·잠금 상태를 확인하세요.');
  process.exitCode = 1;
} finally {
  await Promise.allSettled([first.end(), second.end()]);
}
