// DB 어댑터 계약 — 동기 Db(SQLite·PG 동기 다리)와 비동기 Db(2단계 인터페이스)가 같은 SQL에 같은 답을 준다(D-RD-3, 20-92 §4).
// 기본 verify는 SQLite만, npm run test:pg(FF_TEST_PG_URL)에서는 PostgreSQL도 같은 시험을 돈다.
import { afterAll, describe, expect, it } from 'vitest';
import { asyncDbOf, PgPoolDb, SqliteAsyncDb, type AsyncDb } from '../../src/kernel/async-db';
import { migrate, SqliteDb, type Db } from '../../src/kernel/db';
import { MIGRATIONS } from '../../src/kernel/migrations';
import { dialectContextOf } from '../../src/kernel/pg-dialect';
import { pgAdmin, PgSyncDb } from '../../src/kernel/pg-sync-db';

const PG = process.env.FF_TEST_PG_URL?.trim();
const dbs: string[] = [];

function openPg(): PgSyncDb {
  const name = `ff_t_adapt_${process.pid}_${dbs.length}`;
  pgAdmin(PG!, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  pgAdmin(PG!, `CREATE DATABASE "${name}"`);
  dbs.push(name);
  const u = new URL(PG!);
  u.pathname = `/${name}`;
  return new PgSyncDb({ url: u.toString(), ctx: dialectContextOf(MIGRATIONS) });
}

afterAll(() => {
  for (const d of dbs) pgAdmin(PG!, `DROP DATABASE IF EXISTS "${d}" WITH (FORCE)`);
});

const SYNC: [string, () => Db][] = [['SQLite', () => new SqliteDb(':memory:')], ...(PG ? ([['PostgreSQL', openPg]] as [string, () => Db][]) : [])];

describe.each(SYNC)('동기 Db 계약 — %s', (_name, open) => {
  const fresh = () => {
    const db = open();
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT NOT NULL, n INTEGER)');
    return db;
  };

  it('run은 바뀐 행 수·새 정수 키를, get·all은 행을 돌려준다(정수는 number)', () => {
    const db = fresh();
    try {
      expect(db.run('INSERT INTO t (v, n) VALUES (?, ?)', 'a', 5)).toEqual({ changes: 1, lastInsertRowid: 1 });
      expect(db.run('INSERT INTO t (v, n) VALUES (?, ?)', 'b', 7).lastInsertRowid).toBe(2);
      expect(db.get<{ c: number; s: number }>('SELECT count(*) AS c, sum(n) AS s FROM t')).toEqual({ c: 2, s: 12 });
      expect(db.all<{ v: string }>('SELECT v FROM t ORDER BY id').map((r) => r.v)).toEqual(['a', 'b']);
      expect(db.run('UPDATE t SET n = n + 1').changes).toBe(2);
      expect(db.get('SELECT v FROM t WHERE id = ?', 99)).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('tx: 커밋하면 afterCommit, 예외면 롤백, 중첩은 SAVEPOINT', () => {
    const db = fresh();
    try {
      const seen: string[] = [];
      db.tx(() => {
        db.run("INSERT INTO t (v) VALUES ('x')");
        db.afterCommit(() => seen.push('x'));
        expect(seen).toEqual([]);
        expect(() => db.tx(() => (db.run("INSERT INTO t (v) VALUES ('inner')"), (() => { throw new Error('안쪽'); })()))).toThrow('안쪽');
      });
      expect(seen).toEqual(['x']);
      expect(() => db.tx(() => (db.run("INSERT INTO t (v) VALUES ('y')"), (() => { throw new Error('boom'); })()))).toThrow('boom');
      expect(db.all<{ v: string }>('SELECT v FROM t').map((r) => r.v)).toEqual(['x']);
      expect(db.inTransaction).toBe(false);
    } finally {
      db.close();
    }
  });

  it('마이그레이션 전체가 적용되고 추가 전용 트리거가 수정·삭제를 막는다', () => {
    const db = open();
    try {
      expect(migrate(db, MIGRATIONS)).toHaveLength(MIGRATIONS.length);
      expect(migrate(db, MIGRATIONS)).toEqual([]);
      db.run("INSERT INTO audit (at, actor_id, actor_role, action, target, result, hash) VALUES ('t', 'u', 'R', 'A', 'x', 'ALLOWED', 'h')");
      expect(() => db.run('DELETE FROM audit')).toThrow(/append-only/);
      expect(() => db.run("UPDATE audit SET reason = '조작'")).toThrow(/append-only/);
      // INSERT OR IGNORE — 기본 키 충돌은 조용히 건너뛴다
      expect(db.run("INSERT OR IGNORE INTO meta (key, value) VALUES ('k', '1')").changes).toBe(1);
      expect(db.run("INSERT OR IGNORE INTO meta (key, value) VALUES ('k', '2')").changes).toBe(0);
      expect(db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'k'")?.value).toBe('1');
    } finally {
      db.close();
    }
  });
});

const ASYNC: [string, () => { a: AsyncDb; done: () => Promise<void> }][] = [
  [
    'SQLite',
    () => {
      const db = new SqliteDb(':memory:');
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT NOT NULL)');
      const a = new SqliteAsyncDb(db);
      return { a, done: async () => (await a.close(), db.close()) };
    },
  ],
  ...(PG
    ? ([
        [
          'PostgreSQL',
          () => {
            const db = openPg();
            db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT NOT NULL)');
            const a = asyncDbOf(db);
            expect(a).toBeInstanceOf(PgPoolDb);
            return { a, done: async () => (await a.close(), db.close()) };
          },
        ],
      ] as [string, () => { a: AsyncDb; done: () => Promise<void> }][])
    : []),
];

describe.each(ASYNC)('비동기 Db 계약 — %s', (_name, open) => {
  it('질의·트랜잭션(커밋·롤백) — 동기 Db와 같은 SQL 방언', async () => {
    const { a, done } = open();
    try {
      expect((await a.run('INSERT INTO t (v) VALUES (?)', 'a')).lastInsertRowid).toBe(1);
      await a.tx(async (t) => {
        await t.run('INSERT INTO t (v) VALUES (?)', 'b');
        await t.run('INSERT INTO t (v) VALUES (?)', 'c');
      });
      await expect(
        a.tx(async (t) => {
          await t.run('INSERT INTO t (v) VALUES (?)', 'd');
          throw new Error('롤백');
        }),
      ).rejects.toThrow('롤백');
      expect((await a.all<{ v: string }>('SELECT v FROM t ORDER BY id')).map((r) => r.v)).toEqual(['a', 'b', 'c']);
      expect(await a.get<{ n: number }>('SELECT count(*) AS n FROM t WHERE v LIKE ?', 'A')).toEqual({ n: 1 });
    } finally {
      await done();
    }
  });
});
