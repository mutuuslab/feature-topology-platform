// Feature DB 마이그레이션(080_feature_ref·081_feature_ref_link, docs/30-data-model/30-95 §5.6) — SQLite 표·제약·추가 전용 트리거,
// 075까지 쓰던 DB를 올려도 데이터가 남는지, PG 방언 번역(새 SQLite 전용 구문 없음)을 본다.
import { describe, expect, it } from 'vitest';
import { SqliteDb, migrate } from '../../src/kernel/db';
import { MIGRATIONS } from '../../src/kernel/migrations';
import { dialectContextOf, translateMigration } from '../../src/kernel/pg-dialect';

const fresh = () => {
  const db = new SqliteDb(':memory:');
  migrate(db, MIGRATIONS);
  return db;
};
const REF_TABLES = ['taxonomy_node', 'feature_ref', 'ref_source', 'ref_glossary', 'ref_subfunction', 'ref_release', 'feature_ref_link', 'ref_change'];
const NOW = '2026-11-04T00:00:00.000Z';

describe('Feature DB 마이그레이션', () => {
  it('080·081은 075 뒤에 붙고 Feature DB 표 8개를 만든다', () => {
    const names = MIGRATIONS.map((m) => m.name);
    expect(names.slice(names.indexOf('075_shared_state') + 1, names.indexOf('075_shared_state') + 3)).toEqual(['080_feature_ref', '081_feature_ref_link']);
    const db = fresh();
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    for (const t of REF_TABLES) expect(tables, t).toContain(t);
  });

  it('기준 행 상태·연결 역할·변경 요청 종류는 정해진 값만 받는다', () => {
    const db = fresh();
    db.run('INSERT INTO feature_ref (ref_id, status, domain, component, name_ko, doc, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'CH-BRK-009', 'PENDING', 'Chassis & Vehicle Dynamics', 'Brake control (ESC/ABS)', '오토 홀드', '{}', NOW);
    expect(() => db.run('INSERT INTO feature_ref (ref_id, status, domain, component, name_ko, doc, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'CH-BRK-010', '활성', 'x', 'x', 'x', '{}', NOW)).toThrow();
    // 한 번 쓴 ID는 다시 넣을 수 없다(기본 키)
    expect(() => db.run('INSERT INTO feature_ref (ref_id, status, domain, component, name_ko, doc, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'CH-BRK-009', 'ACTIVE', 'x', 'x', 'x', '{}', NOW)).toThrow();
    db.run('INSERT INTO feature_ref_link (feature_id, version, ref_id, role, ref_version) VALUES (?, ?, ?, ?, ?)', 'FEAT-00001', '0.1.0', 'CH-BRK-009', 'PRIMARY', 'v1.3');
    expect(() => db.run('INSERT INTO feature_ref_link (feature_id, version, ref_id, role, ref_version) VALUES (?, ?, ?, ?, ?)', 'FEAT-00001', '0.1.0', 'CH-BRK-009', 'INCLUDED', 'v1.3')).toThrow(); // 같은 버전에 같은 행 두 번
    expect(() => db.run('INSERT INTO feature_ref_link (feature_id, version, ref_id, role, ref_version) VALUES (?, ?, ?, ?, ?)', 'FEAT-00001', '0.1.0', 'CH-BRK-006', 'MAIN', 'v1.3')).toThrow();
    expect(() => db.run('INSERT INTO ref_change (change_id, kind, ref_id, status, doc, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'CR-2026-011', 'UPDATE', 'CH-BRK-009', 'DRAFT', '{}', 'usr-author', NOW)).toThrow();
    db.run('INSERT INTO ref_change (change_id, kind, ref_id, status, doc, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'CR-2026-011', 'ADD', 'CH-BRK-009', 'REVIEW', '{}', 'usr-author', NOW);
    db.run("UPDATE ref_change SET status = 'APPROVED' WHERE change_id = ?", 'CR-2026-011'); // 변경 요청은 상태가 바뀐다
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM feature_ref_link WHERE ref_id = ?', 'CH-BRK-009')!.n).toBe(1);
  });

  it('발행 이력(ref_release)은 추가만 가능하다', () => {
    const db = fresh();
    db.run('INSERT INTO ref_release (release_id, published_by, published_at, hash, doc) VALUES (?, ?, ?, ?, ?)', 'v1.3', 'usr-steward', NOW, 'a'.repeat(64), '{}');
    expect(() => db.run("UPDATE ref_release SET hash = 'b' WHERE release_id = 'v1.3'")).toThrow(/추가만/);
    expect(() => db.run("DELETE FROM ref_release WHERE release_id = 'v1.3'")).toThrow(/추가만/);
    db.run('INSERT INTO ref_release (release_id, published_by, published_at, hash, doc) VALUES (?, ?, ?, ?, ?)', 'v1.4', 'usr-steward', NOW, 'c'.repeat(64), '{}');
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM ref_release')!.n).toBe(2);
  });

  it('075까지 쓰던 DB에 Feature 버전이 있어도 080·081을 올리면 그대로 남는다', () => {
    const at = MIGRATIONS.findIndex((m) => m.name === '075_shared_state') + 1;
    const old = new SqliteDb(':memory:');
    migrate(old, MIGRATIONS.slice(0, at));
    old.run('INSERT INTO feature_version (feature_id, version, lifecycle, baseline_id, doc, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', 'FEAT-00001', '0.1.0', 'PROPOSED', null, '{"featureId":"FEAT-00001"}', 'usr-author', NOW);
    expect(migrate(old, MIGRATIONS)).toEqual(MIGRATIONS.slice(at).map((m) => m.name));
    expect(old.get<{ n: number }>('SELECT count(*) AS n FROM feature_version')!.n).toBe(1);
    expect(old.get<{ n: number }>('SELECT count(*) AS n FROM feature_ref_link')!.n).toBe(0);
  });

  it('PG 방언으로 번역된다 — 추가 전용 트리거는 plpgsql 함수, 정수 키는 IDENTITY', () => {
    const ctx = dialectContextOf(MIGRATIONS);
    const pg = MIGRATIONS.filter((m) => m.name.startsWith('08')).map((m) => translateMigration(m, ctx)).join('\n');
    expect(pg).toContain('CREATE TRIGGER ref_release_no_update BEFORE UPDATE ON ref_release FOR EACH ROW EXECUTE FUNCTION ff_trg_ref_release_no_update();');
    expect(pg).toContain('CREATE TRIGGER ref_release_no_delete BEFORE DELETE ON ref_release FOR EACH ROW EXECUTE FUNCTION ff_trg_ref_release_no_delete();');
    expect(pg).toContain('id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY');
    expect(pg).not.toMatch(/\bAUTOINCREMENT\b|RAISE\s*\(\s*ABORT/i);
    expect(ctx.intKey.get('ref_subfunction')).toBe('id');
    expect(ctx.triggerTable.get('ref_release_no_delete')).toBe('ref_release');
  });
});
