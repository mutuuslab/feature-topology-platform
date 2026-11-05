// Feature DB 이전 점검 — 커밋된 v1.3 데이터는 통과하고, 복사본을 망가뜨리면(ID 중복·상태·출처·규모·해시) 잡는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { checkRefdb, contractRefIdPattern, REFDB_DIR, REFDB_SOURCE_XLSX, reimportRefdb } from './check.ts';
import { FF } from '../lib.ts';
import { cmpId, excelDate, serialize, sha256 } from './import-lib.ts';
import { RUNTIME_DATA } from '../desktop-prepare.mjs';

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

test('원본 엑셀 사본을 다시 가져오면 커밋된 v1.3과 같고, 이전본을 한쪽만 고치면 잡는다', () => {
  assert.deepEqual(reimportRefdb().errors, []);
  const { dir, cleanup } = mutated((refs) => { refs[0].nameKo += ' (손 수정)'; });
  try {
    assert.deepEqual(reimportRefdb(REFDB_SOURCE_XLSX, dir).errors.map((e) => e.split(':')[0]), ['Feature DB refs.json', 'Feature DB manifest.json']);
  } finally {
    cleanup();
  }
});

test('배포 묶음(Docker 이미지·데스크톱 런타임)에 Feature DB 이전본이 들어간다', () => {
  // 회귀: data/reference를 복사하지 않아 고객 설치 첫 기동의 Feature DB 시드가 NO_DATA로 건너뛰어졌다(2026-11-04 병합 점검)
  const docker = readFileSync(join(FF, 'docker', 'app', 'Dockerfile'), 'utf8');
  assert.match(docker, /^COPY data\/reference \.\/data\/reference\r?$/m);
  assert.ok(RUNTIME_DATA.includes('reference'), 'desktop-prepare RUNTIME_DATA에 reference 없음');
});

/** 분류 표를 고친 사본(manifest 해시는 맞춤) */
function mutatedTaxonomy(edit: (tax: any[]) => void): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'refdb-check-'));
  cpSync(REFDB_DIR, dir, { recursive: true });
  const tax = JSON.parse(readFileSync(join(dir, 'taxonomy.json'), 'utf8'));
  edit(tax);
  const text = serialize(tax);
  writeFileSync(join(dir, 'taxonomy.json'), text);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  manifest.files.taxonomy = { rows: tax.length, sha256: sha256(text) };
  writeFileSync(join(dir, 'manifest.json'), serialize(manifest));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('ID 형식은 contracts REF_ID_PATTERN — 옛 자체 정규식이 통과시키던 ID(숫자로 시작·5자 약어)를 잡는다', () => {
  const re = contractRefIdPattern();
  const dist = join(FF, 'contracts', 'dist', 'index.js');
  if (existsSync(dist)) assert.equal(re.source, createRequire(import.meta.url)(dist).REF_ID_PATTERN.source, '정의 줄 읽기가 빌드된 계약과 다르다');
  assert.ok(re.test('BC-BCM-001') && re.test('CO-V2X-003'));
  for (const bad of ['BC-1BC-001', 'BC-ABCDE-001']) {
    assert.equal(re.test(bad), false, bad);
    assert.match(bad, /^[A-Z]{2}-[A-Z0-9]{2,5}-\d{3}$/, '옛 정규식은 통과시켰다');
    const m = mutated((refs) => { refs[5].refId = bad; });
    try {
      assert.ok(checkRefdb(m.dir, null).errors.some((e) => e.includes(`${bad}: ID 형식`)), bad);
    } finally { m.cleanup(); }
  }
  assert.throws(() => contractRefIdPattern('export const X = 1;'), /REF_ID_PATTERN/);
});

test('도메인·컴포넌트 약어(abbr)가 비거나 ID 형식에 맞지 않으면 실패한다', () => {
  const tax = JSON.parse(readFileSync(join(REFDB_DIR, 'taxonomy.json'), 'utf8')) as { nodeId: string; level: string; abbr: string | null }[];
  assert.deepEqual(tax.filter((n) => n.level !== 'CLUSTER' && !n.abbr).map((n) => n.nodeId), []);
  const comp = tax.find((n) => n.level === 'COMPONENT')!;
  const dom = tax.find((n) => n.level === 'DOMAIN')!;
  const m = mutatedTaxonomy((t) => {
    t.find((n) => n.nodeId === comp.nodeId).abbr = null;
    t.find((n) => n.nodeId === dom.nodeId).abbr = '';
    t.filter((n) => n.level === 'COMPONENT')[1].abbr = '9X';
  });
  try {
    const { errors } = checkRefdb(m.dir, null);
    assert.ok(errors.some((e) => e.includes(`${comp.nodeId}: COMPONENT 약어(abbr) 없음`)), errors.join('\n'));
    assert.ok(errors.some((e) => e.includes(`${dom.nodeId}: DOMAIN 약어(abbr) 없음`)), errors.join('\n'));
    assert.ok(errors.some((e) => e.includes(`약어 '9X'로 기준 행 ID 형식을 만들 수 없음`)), errors.join('\n'));
  } finally { m.cleanup(); }
});
