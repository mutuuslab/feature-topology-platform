import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pgTestConfig, pgTestDatabaseIdentifier, pgTestEnvironment } from './pg-test-config.ts';

test('Docker 기본값은 유지하고, 분리한 로컬 Native PG만 명시적으로 허용한다', () => {
  assert.deepEqual(pgTestConfig({}), { native: false, url: 'postgres://ff:ff@127.0.0.1:9690/ff', port: 9690, workers: 4 });
  const env = { FF_PG_TEST_NATIVE_URL: 'postgresql://tester:secret@127.0.0.1:9690/ff_test', FF_PG_TEST_WORKERS: '2' };
  assert.equal(pgTestConfig(env).native, true);
  assert.equal('FF_TEST_PG_URL' in env, false); // verify 기본 SQLite 시험에 PG 설정을 퍼뜨리지 않는다.
  assert.equal(pgTestConfig({ FF_TEST_PG_URL: 'postgres://tester@[::1]:9690/ff_test' }).port, 9690);
});

test('고객 DB·외부 주소·질의 옵션과 잘못된 작업자 수를 거부하며 비밀 URI를 오류에 남기지 않는다', () => {
  for (const value of ['postgres://owner:secret@db.example/ff_test', 'postgres://owner:secret@localhost/feature_platform', 'postgres://owner:secret@localhost/postgres', 'postgres://owner:secret@localhost/ff_test?host=remote', 'https://owner:secret@localhost/ff_test']) {
    assert.throws(() => pgTestConfig({ FF_TEST_PG_URL: value }), (error: Error) => !error.message.includes('secret') && !error.message.includes(value));
  }
  for (const workers of ['0', '5', '1.5', 'bad']) assert.throws(() => pgTestConfig({ FF_PG_TEST_WORKERS: workers }));
});

test('정리 SQL은 시험 접두사만 쓰고, 식별자의 따옴표를 이스케이프한다', () => {
  assert.equal(pgTestDatabaseIdentifier('ff_t_123'), '"ff_t_123"');
  assert.equal(pgTestDatabaseIdentifier('ff_tpl_a"b'), '"ff_tpl_a""b"');
  for (const name of ['feature_platform', 'unleash', 'postgres', 'ffXtpl_data']) assert.throws(() => pgTestDatabaseIdentifier(name));
});

test('상속한 고객 DB URL·schema가 시험 연결보다 우선하지 못하며 부모 환경은 보존한다', () => {
  const parent = { FF_DB_URL: 'postgres://owner:secret@customer.example/customer', FF_DB_SCHEMA: 'customer', FF_DB: 'customer.db', FF_TEST_PG_URL: 'wrong', PATH: 'kept' };
  const url = 'postgres://test@localhost:9690/ff_test';
  const env = pgTestEnvironment(parent, url);
  assert.equal(env.FF_DB_URL, undefined);
  assert.equal(env.FF_DB_SCHEMA, undefined);
  assert.equal(env.FF_DB, ':memory:');
  assert.equal(env.FF_TEST_PG_URL, url);
  assert.equal(env.PATH, 'kept');
  assert.equal(parent.FF_DB_SCHEMA, 'customer');
  assert.equal(parent.FF_DB, 'customer.db');
});
