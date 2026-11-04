// Feature DB 이전 점검 — 커밋된 v1.3 데이터는 통과하고, 복사본을 망가뜨리면(ID 중복·상태·출처·규모·해시) 잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkRefdb, REFDB_DIR } from './check.ts';
import { cmpId, excelDate, serialize, sha256 } from './import-lib.ts';

/** v1.3 폴더를 임시 폴더로 복사해 refs.json을 고치고, manifest 해시는 맞춰 둔다(해시가 아니라 내용 점검이 잡는지 보려고) */
function mutated(edit: (refs: any[]) => void, fixHash = true): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'refdb-check-'));
  cpSync(REFDB_DIR, dir, { recursive: true });
  const refs = JSON.parse(readFileSync(join(dir, 'refs.json'), 'utf8'));
  edit(refs);
  const text = serialize(refs);
  writeFileSync(join(dir, 'refs.json'), text);
  if (fixHash) {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.files.refs = { rows: refs.length, sha256: sha256(text) };
    writeFileSync(join(dir, 'manifest.json'), serialize(manifest));
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('커밋된 Feature DB v1.3은 이전 점검을 모두 통과한다(1,052행·995/53/4·T·U·BW 일치·시드 대응표)', () => {
  const { errors, summary } = checkRefdb();
  assert.deepEqual(errors, []);
  assert.match(summary, /1052행 · 상태 995\/53\/4/);
  assert.match(summary, /파생 값 T·U·BW 1052행 일치/);
});

test('ID 중복은 실패한다', () => {
  let dup = '';
  const m = mutated((refs) => { dup = refs[0].refId; refs[1].refId = dup; });
  try {
    const { errors } = checkRefdb(m.dir, null);
    assert.ok(errors.some((e) => e.includes(`${dup}: ID 중복`)), errors.join('\n'));
  } finally { m.cleanup(); }
});

test('상태·출처·필수 정보·규모가 틀리면 각각 잡는다', () => {
  const m = mutated((refs) => {
    refs[0].status = 'REVIEW'; // 995/53 → 994/54
    refs[2].sourceIds = ['S999'];
    refs[3].nameKo = '';
    refs[4].tshirt = 'XL'; // 엑셀 저장 T·U와 달라진다
  });
  try {
    const { errors } = checkRefdb(m.dir, null);
    const has = (s: string) => assert.ok(errors.some((e) => e.includes(s)), `'${s}' 없음:\n${errors.join('\n')}`);
    has('상태 ACTIVE 994행 ≠ 엑셀 995행');
    has('출처 S999가 sources.json에 없음');
    has('필수 정보 nameKo 비어 있음');
    has('등급 포인트 T 재계산 55');
  } finally { m.cleanup(); }
});

test('분류 노드 ID가 겹치면 실패한다 — 회귀: 클러스터·컴포넌트 이름이 같은 4쌍이 같은 nodeId였다', () => {
  // 커밋된 분류 표는 수준마다 다른 ID(클러스터 'BC:Mirrors' · 컴포넌트 'BC/Mirrors')
  const tax = JSON.parse(readFileSync(join(REFDB_DIR, 'taxonomy.json'), 'utf8')) as { nodeId: string; level: string; nameEn: string; parentId: string | null }[];
  assert.equal(new Set(tax.map((n) => n.nodeId)).size, tax.length);
  const same = tax.filter((n) => n.level === 'COMPONENT' && tax.some((c) => c.level === 'CLUSTER' && c.parentId === n.parentId && c.nameEn === n.nameEn));
  assert.deepEqual(same.map((n) => n.nodeId).sort(), ['BC/Interior lighting', 'BC/Mirrors', 'IN/Instrument cluster', 'IN/Navigation']);
  // 옛 방식(컴포넌트도 'BC:Mirrors')으로 되돌리면 잡는다
  const dir = mkdtempSync(join(tmpdir(), 'refdb-check-'));
  try {
    cpSync(REFDB_DIR, dir, { recursive: true });
    const broken = tax.map((n) => (n.nodeId === 'BC/Mirrors' ? { ...n, nodeId: 'BC:Mirrors' } : n));
    const text = serialize(broken);
    writeFileSync(join(dir, 'taxonomy.json'), text);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    manifest.files.taxonomy = { rows: broken.length, sha256: sha256(text) };
    writeFileSync(join(dir, 'manifest.json'), serialize(manifest));
    const { errors } = checkRefdb(dir, null);
    assert.ok(errors.some((e) => e.includes('BC:Mirrors: 노드 ID 중복(COMPONENT)')), errors.join('\n'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('손으로 고친 파일은 manifest 해시로 잡는다', () => {
  const m = mutated((refs) => { refs[0].adminMemo = '손 수정'; }, false);
  try {
    assert.ok(checkRefdb(m.dir, null).errors.some((e) => e.includes('refs.json 해시가 manifest와 다름')));
  } finally { m.cleanup(); }
});

test('가져오기 보조 — 숫자를 수로 비교하는 ID 정렬·엑셀 날짜 일련번호', () => {
  assert.deepEqual(['S10', 'S9', 'S01'].sort(cmpId), ['S01', 'S9', 'S10']);
  assert.deepEqual(['BC-BCM-010', 'BC-BCM-002', 'AD-LAT-001'].sort(cmpId), ['AD-LAT-001', 'BC-BCM-002', 'BC-BCM-010']);
  assert.equal(excelDate('46285'), '2026-09-20');
  assert.equal(excelDate('2026-09-29'), '2026-09-29');
  assert.equal(excelDate(''), null);
});
