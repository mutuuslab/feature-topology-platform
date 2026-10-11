import { describe, expect, it } from 'vitest';
import { SqliteDb, migrate } from '../../src/kernel/db';
import { MIGRATIONS } from '../../src/kernel/migrations';

const fresh = () => {
  const db = new SqliteDb(':memory:');
  db.exec('CREATE TABLE t (v TEXT)');
  return db;
};
const count = (db: SqliteDb) => db.get<{ n: number }>('SELECT count(*) n FROM t')!.n;

describe('SqliteDb 트랜잭션', () => {
  it('커밋하면 남고 afterCommit이 실행된다', () => {
    const db = fresh();
    const seen: string[] = [];
    db.tx(() => {
      db.run('INSERT INTO t VALUES (?)', 'a');
      db.afterCommit(() => seen.push('a'));
      expect(seen).toEqual([]); // 커밋 전에는 실행되지 않는다
    });
    expect(count(db)).toBe(1);
    expect(seen).toEqual(['a']);
  });

  it('예외가 나면 롤백되고 afterCommit은 버려진다', () => {
    const db = fresh();
    const seen: string[] = [];
    expect(() =>
      db.tx(() => {
        db.run('INSERT INTO t VALUES (?)', 'a');
        db.afterCommit(() => seen.push('a'));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(count(db)).toBe(0);
    expect(seen).toEqual([]);
    expect(db.inTransaction).toBe(false);
  });

  it('중첩 tx는 SAVEPOINT — 안쪽만 롤백할 수 있다', () => {
    const db = fresh();
    db.tx(() => {
      db.run('INSERT INTO t VALUES (?)', 'outer');
      expect(() => db.tx(() => (db.run('INSERT INTO t VALUES (?)', 'inner'), (() => { throw new Error('x'); })()))).toThrow();
    });
    expect(db.all<{ v: string }>('SELECT v FROM t').map((r) => r.v)).toEqual(['outer']);
  });

  it('비동기 콜백은 거부한다 (동기 API에서 커밋 시점이 어긋나는 사고 방지)', () => {
    const db = fresh();
    expect(() => db.tx(() => Promise.resolve(1) as any)).toThrow(/동기/);
  });

  it('마이그레이션은 한 번만 적용된다', () => {
    const db = new SqliteDb(':memory:');
    expect(migrate(db, MIGRATIONS)).toEqual(['001_kernel', '002_dataset_v081']);
    expect(migrate(db, MIGRATIONS)).toEqual([]);
  });
});
