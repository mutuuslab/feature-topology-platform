// DB 어댑터 고르기 — 기본은 SQLite(FF_DB 파일 또는 :memory:). FF_DB_URL=postgres://…면 PostgreSQL(미리보기, D-RD-3).
// 시험 전용: FF_TEST_PG_URL이 있으면 메모리 DB 요청(:memory:)을 그 PG의 새 데이터베이스로 바꾼다 — 같은 시험 묶음을
// PG에서 돌려 호환률을 재는 하네스(npm run test:pg, 20-92 §6). 마이그레이션·시드를 끝낸 틀 데이터베이스를 한 번 만들고
// 부팅마다 복제한다(CREATE DATABASE … TEMPLATE). 운영 모드는 :memory:를 거부하므로(runtime-config) 이 변수가 있어도 운영 DB를 바꾸지 않는다.
import { createHash } from 'node:crypto';
import { migrate, SqliteDb, type Db } from './db';
import { MIGRATIONS } from './migrations';
import { dialectContextOf } from './pg-dialect';
import { pgAdmin, PgSyncDb } from './pg-sync-db';
import { seedOf } from './runtime-config';
import { loadFixtures, seedAnchor, seedDataset, seedDemo } from './seed';

type Env = Record<string, string | undefined>;

export const isPgUrl = (v: string | undefined) => !!v && /^postgres(ql)?:\/\//i.test(v.trim());

/** 지금 설정이 가리키는 DB 종류 */
export function dbKindOf(env: Env = process.env): 'postgres' | 'sqlite-file' | 'sqlite-memory' {
  if (isPgUrl(env.FF_DB_URL)) return 'postgres';
  const file = (env.FF_DB ?? ':memory:').trim();
  if (file === ':memory:' && isPgUrl(env.FF_TEST_PG_URL)) return 'postgres';
  return file === ':memory:' ? 'sqlite-memory' : 'sqlite-file';
}

/** 부팅 시드 — FF_SEED(기본 v0.81, 운영 none). 이미 적재된 DB는 건드리지 않는다 */
export function applySeed(db: Db, env: Env = process.env) {
  const seed = seedOf(env);
  if (seed === 'none') return;
  seedDataset(db, loadFixtures(), seed);
  seedDemo(db);
}

export function openDb(env: Env = process.env): Db {
  if (isPgUrl(env.FF_DB_URL)) return new PgSyncDb({ url: env.FF_DB_URL!.trim(), schema: env.FF_DB_SCHEMA?.trim() || undefined, ctx: dialectContextOf(MIGRATIONS) });
  const file = (env.FF_DB ?? ':memory:').trim();
  if (file === ':memory:' && isPgUrl(env.FF_TEST_PG_URL)) return openTestPg(env.FF_TEST_PG_URL!.trim(), env);
  return new SqliteDb(file);
}

const withDatabase = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};

let seq = 0;

/** 시험 PG — 틀(마이그레이션+시드)을 복제한 새 데이터베이스. 닫으면 지운다 */
function openTestPg(url: string, env: Env): Db {
  const seed = seedOf(env);
  const key = createHash('sha256')
    .update(JSON.stringify([MIGRATIONS.map((m) => [m.name, m.sql, m.pg ?? null]), seed, seed === 'none' ? null : seedAnchor(), env.FF_FIXTURES ?? null, env.FF_DEMO_FIXTURES ?? null, env.FF_SYNTHETIC ?? null]))
    .digest('hex')
    .slice(0, 16);
  const tpl = `ff_tpl_${key}`;
  pgAdmin(url, 'SELECT pg_advisory_lock(7291001)');
  try {
    if (!pgAdmin(url, 'SELECT 1 FROM pg_database WHERE datname = $1', tpl).length) {
      const build = `${tpl}_b${process.pid}`;
      pgAdmin(url, `DROP DATABASE IF EXISTS "${build}" WITH (FORCE)`);
      pgAdmin(url, `CREATE DATABASE "${build}"`);
      const db = new PgSyncDb({ url: withDatabase(url, build), ctx: dialectContextOf(MIGRATIONS) });
      try {
        migrate(db, MIGRATIONS);
        applySeed(db, env);
      } finally {
        db.close();
      }
      pgAdmin(url, `ALTER DATABASE "${build}" RENAME TO "${tpl}"`);
      pgAdmin(url, `ALTER DATABASE "${tpl}" IS_TEMPLATE true`);
    }
  } finally {
    pgAdmin(url, 'SELECT pg_advisory_unlock(7291001)');
  }
  const name = `ff_t_${process.pid}_${++seq}_${Date.now().toString(36)}`;
  pgAdmin(url, `CREATE DATABASE "${name}" TEMPLATE "${tpl}" STRATEGY FILE_COPY`);
  return new PgSyncDb({ url: withDatabase(url, name), ctx: dialectContextOf(MIGRATIONS), onClose: () => pgAdmin(url, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`) });
}
