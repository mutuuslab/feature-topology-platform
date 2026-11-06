// 마이그레이션 올리기 — 이전 판 스키마에 데이터가 든 DB를 지금 판으로 올려도 데이터가 남고, 새로 만든 DB와 스키마가 같다(출시 준비 RD-OPS-10).
// 고객 설치는 빈 DB가 아니라 운영 데이터가 든 DB를 올린다. 시험이 메모리 DB를 처음부터만 만들면, 데이터가 있을 때만 깨지는
// 마이그레이션(NOT NULL 열 추가·표 다시 만들기·트리거)을 놓친다. 이미 낸 마이그레이션의 SQL이 바뀌지 않았는지는 harness/migrations.lock.json.
// readiness: RD-OPS-10
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteDb, migrate } from '../../src/kernel/db';
import { MIGRATIONS } from '../../src/kernel/migrations';

const LOCK = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'harness', 'migrations.lock.json'), 'utf8')) as { note: string; migrations: Record<string, string> };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** 스키마 지문 — 표·색인·트리거·뷰의 SQL(공백 정리) */
function schema(db: SqliteDb): string[] {
  return db
    .all<{ type: string; name: string; sql: string | null }>("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .map((r) => `${r.type} ${r.name}: ${(r.sql ?? '').replace(/\s+/g, ' ').trim()}`);
}

/** 뒤 마이그레이션이 기존 행의 doc에서 읽는 필드(json_extract) — 실제 도메인 doc은 이 필드를 늘 갖는다(contracts 스키마 필수 필드).
 *  빈 '{}'로 채우면 실제로는 일어나지 않는 NULL 실패가 난다 */
const DOC = JSON.stringify(Object.fromEntries([...new Set(MIGRATIONS.flatMap((m) => [...m.sql.matchAll(/json_extract\(\w*\.?doc, '\$\.(\w+)'\)/g)].map((x) => x[1])))].map((k) => [k, `x-${k}`])));

/** 표마다 행 하나 — 열 형식에 맞는 값, CHECK·외래 키는 시도해 보고 안 되면 다음 후보 */
function fill(db: SqliteDb): Record<string, number> {
  const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'").map((r) => r.name);
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const cols = db.all<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>(`PRAGMA table_info(${JSON.stringify(t)})`);
    const ins = cols.filter((c) => !(c.pk && /INT/i.test(c.type)));
    const value = (c: (typeof cols)[number], i: number) => (/INT|REAL|NUM/i.test(c.type) ? i + 1 : /JSON|doc/i.test(c.name) ? DOC : c.name.endsWith('_at') || c.name === 'at' ? '2026-01-01T00:00:00.000Z' : `x${i}`);
    for (const attempt of [0, 1]) {
      try {
        db.run(`INSERT INTO ${JSON.stringify(t)} (${ins.map((c) => JSON.stringify(c.name)).join(', ')}) VALUES (${ins.map(() => '?').join(', ')})`, ...ins.map((c, i) => (attempt ? value(c, i) : (c.notnull || c.pk ? value(c, i) : null)) as string | number | null));
        break;
      } catch {
        /* CHECK·트리거가 막으면 이 표는 비운 채로 — 다른 표로 */
      }
    }
    counts[t] = db.get<{ n: number }>(`SELECT count(*) AS n FROM ${JSON.stringify(t)}`)!.n;
  }
  return counts;
}

describe('마이그레이션 올리기', () => {
  it('이미 낸 마이그레이션은 바뀌지 않는다 — 잠금(harness/migrations.lock.json)과 SQL 해시가 같고, 새 항목은 뒤에만 붙는다', () => {
    const names = MIGRATIONS.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(names);
    for (const [name, hash] of Object.entries(LOCK.migrations)) {
      const m = MIGRATIONS.find((x) => x.name === name);
      expect(m, `${name}이 사라졌다 — 낸 마이그레이션은 지우지 않는다`).toBeDefined();
      expect(sha(m!.sql), `${name}의 SQL이 바뀌었다 — 고치지 말고 새 마이그레이션을 추가`).toBe(hash);
    }
    const last = Object.keys(LOCK.migrations).sort().at(-1)!;
    for (const n of names.filter((x) => !(x in LOCK.migrations))) expect(n > last, `${n}은 잠근 마지막(${last}) 뒤에 와야 한다`).toBe(true);
  });

  // 이전 판 지점 — 끝에서 1·3·8·20개 전, 그리고 처음 몇 개만 적용한 아주 오래된 설치
  const cuts = [...new Set([1, 3, 8, 20, MIGRATIONS.length - 3].map((k) => MIGRATIONS.length - k).filter((n) => n > 0 && n < MIGRATIONS.length))];
  for (const at of cuts) {
    it(`${MIGRATIONS[at - 1].name}까지 쓰던 DB에 데이터를 넣고 올리면 행이 남고 스키마가 새 DB와 같다`, () => {
      const old = new SqliteDb(':memory:');
      migrate(old, MIGRATIONS.slice(0, at));
      const before = fill(old);
      const filled = Object.values(before).filter((n) => n > 0).length;
      // 대부분의 표에 데이터가 들어가야 시험이 뜻이 있다
      expect(filled / Object.keys(before).length).toBeGreaterThan(0.6);
      const applied = migrate(old, MIGRATIONS);
      expect(applied).toEqual(MIGRATIONS.slice(at).map((m) => m.name));
      for (const [t, n] of Object.entries(before)) {
        const still = old.get<{ n: number } | undefined>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", t)?.n;
        if (!still) continue; // 뒤 마이그레이션이 일부러 없앤 표
        expect(old.get<{ n: number }>(`SELECT count(*) AS n FROM ${JSON.stringify(t)}`)!.n, `${t} 행이 올리는 중에 사라졌다`).toBe(n);
      }
      const fresh = new SqliteDb(':memory:');
      migrate(fresh, MIGRATIONS);
      expect(schema(old)).toEqual(schema(fresh));
      old.close();
      fresh.close();
    });
  }
});
