// A native test cluster must be explicitly local and separate from customer databases.
export function pgTestConfig(env: Record<string, string | undefined>) {
  const workers = Number(env.FF_PG_TEST_WORKERS ?? 4);
  if (!Number.isInteger(workers) || workers < 1 || workers > 4) throw new Error('FF_PG_TEST_WORKERS는 1~4 정수여야 합니다.');
  const port = Number(env.FF_PG_TEST_PORT ?? 9690);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PG 시험 포트를 확인하세요.');
  const nativeUrl = env.FF_PG_TEST_NATIVE_URL ?? env.FF_TEST_PG_URL;
  if (!nativeUrl) return { native: false, url: `postgres://ff:ff@127.0.0.1:${port}/ff`, port, workers };
  try {
    const u = new URL(nativeUrl);
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || u.pathname !== '/ff_test' || !u.username || u.search || u.hash) throw new Error();
    return { native: true, url: nativeUrl, port: Number(u.port || 5432), workers };
  } catch {
    // Never include the input URI: it can contain a password.
    throw new Error('Native PG 시험 URL은 loopback의 분리된 ff_test 데이터베이스를 가리켜야 합니다.');
  }
}

export function pgTestDatabaseIdentifier(name: string): string {
  if (!/^ff_(?:t|tpl)_/.test(name)) throw new Error('시험용 데이터베이스 이름만 정리할 수 있습니다.');
  return '"' + name.replaceAll('"', '""') + '"';
}

/** Test workers must never inherit a customer connection that outranks FF_TEST_PG_URL in openDb(). */
export function pgTestEnvironment(parent: Record<string, string | undefined>, testUrl: string) {
  const env: Record<string, string | undefined> = { ...parent, FF_TEST_PG_URL: testUrl, FF_DB: ':memory:' };
  delete env.FF_DB_URL;
  delete env.FF_DB_SCHEMA;
  return env;
}
