// 문서 메타데이터 검사 — 프런트매터 스키마·추적 ID 등록·래칫·Feature DB 문서 수치. 고의로 망가뜨리면 잡는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDoc, collect, DOCS, evaluate, key, loadRefdbData, loadSchema, parseFrontmatter, refdbClaimViolations, registeredIds, type Ctx } from './docs-meta.ts';

const ctx: Ctx = {
  schema: loadSchema(readFileSync(join(DOCS, '_templates', 'frontmatter-schema.yaml'), 'utf8')),
  registry: registeredIds(readFileSync(join(DOCS, '_meta', 'id-registry.yaml'), 'utf8')),
};
const REFDB = '30-data-model/30-95-feature-reference-db.md';
const refdbText = readFileSync(join(DOCS, REFDB), 'utf8');
const kinds = (text: string) => checkDoc('x.md', text, ctx).map((v) => `${v.kind}:${v.detail}`);

const GOOD = [
  '---',
  'id: ARC-FEATURE-REFDB',
  'type: entity',
  'title: "Feature DB"',
  'status: approved',
  'version: 0.3.0',
  'owner: feature-architect',
  'cycle: 0',
  'traces:',
  '  satisfies: [FR-1, FR-2]',
  '  depends_on:',
  '    - ARC-TAXONOMY',
  'last_updated: 2026-11-04',
  '---',
  '# 본문',
].join('\r\n');

test('프런트매터 — 흐름 목록·블록 목록·traces 하위 키를 읽는다', () => {
  const fm = parseFrontmatter(GOOD)!;
  assert.equal(fm.status, 'approved');
  assert.deepEqual(fm.traces, { satisfies: ['FR-1', 'FR-2'], depends_on: ['ARC-TAXONOMY'] });
  assert.equal(parseFrontmatter('# 프런트매터 없음'), null);
});

test('스키마 — 필수 필드 8개, status·type·owner enum, id 형식을 frontmatter-schema.yaml에서 읽는다', () => {
  assert.deepEqual(ctx.schema.required, ['id', 'type', 'title', 'status', 'version', 'owner', 'cycle', 'last_updated']);
  assert.deepEqual(ctx.schema.enums.status, ['draft', 'in-review', 'approved', 'baselined', 'deprecated']);
  assert.ok(ctx.schema.enums.owner.includes('feature-architect'));
  assert.ok(ctx.schema.idPattern.test('ARC-FEATURE-REFDB') && !ctx.schema.idPattern.test('OVERVIEW-VISION'));
});

test('Feature DB·산정·ALM 문서 ID가 레지스트리에 있다', () => {
  for (const id of ['ARC-FEATURE-REFDB', 'ARC-COST-ESTIMATION', 'ARC-TAXONOMY', 'INT-ALM-SYNC', 'INT-CODEBEAMER-EVIDENCE']) assert.ok(ctx.registry.has(id), id);
});

test('맞는 프런트매터는 위반 0', () => {
  assert.deepEqual(kinds(GOOD), []);
});

test('스키마 enum 밖 status(implemented)·cycle 없음을 잡는다', () => {
  const bad = GOOD.replace('status: approved', 'status: implemented').replace('cycle: 0\r\n', '');
  assert.deepEqual(kinds(bad), ['missing:cycle', 'enum:status=implemented']);
});

test('레지스트리에 없는 추적 ID·문서 ID를 잡는다', () => {
  assert.deepEqual(kinds(GOOD.replace('ARC-TAXONOMY', 'ARC-NO-SUCH')), ['trace-unregistered:ARC-NO-SUCH']);
  assert.deepEqual(kinds(GOOD.replace('id: ARC-FEATURE-REFDB', 'id: ARC-NOT-REGISTERED')), ['id-unregistered:ARC-NOT-REGISTERED']);
  assert.deepEqual(kinds(GOOD.replace('id: ARC-FEATURE-REFDB', 'id: REQ-INDEX')), ['id-pattern:REQ-INDEX']);
});

test('래칫 — 기준에 있는 기존 위반은 통과, 새 위반·최근 고친 문서의 위반은 실패, 사라진 위반은 개선으로 보고', () => {
  const old = { doc: 'a.md', kind: 'trace-unregistered', detail: 'TC-001' };
  const neu = { doc: 'a.md', kind: 'trace-unregistered', detail: 'TC-999' };
  const gone = 'b.md | no-frontmatter | -';
  const r = evaluate([old, neu], [key(old), gone], new Set());
  assert.deepEqual(r.fresh, [neu]);
  assert.equal(r.known, 1);
  assert.deepEqual(r.stale, [gone]);
  assert.deepEqual(evaluate([old], [key(old)], new Set(['a.md'])).fresh, [old]);
});

test('30-95 수치가 Feature DB v1.3 데이터와 같다(1,052행·995/53/4·출처 73·세부기능 840·정의 24·도메인 10·컴포넌트 69)', () => {
  assert.deepEqual(refdbClaimViolations(refdbText, loadRefdbData()), []);
});

test('30-95 수치를 망가뜨리면 잡는다 — 옛 출처 155행, 상태 수, 문장 삭제', () => {
  const data = loadRefdbData();
  const stale = refdbClaimViolations(refdbText.replace('`09_출처` (73행)', '`09_출처` (155행)'), data);
  assert.deepEqual(stale.map((v) => v.detail), ['출처 행: 문서 155 ↔ 데이터 73']);
  assert.equal(refdbClaimViolations(refdbText.replace('상태 수 995/53/4', '상태 수 995/52/4'), data)[0].kind, 'number-mismatch');
  assert.equal(refdbClaimViolations(refdbText.replace('`13_세부기능후보` (840행)', '`13_세부기능후보`'), data)[0].kind, 'number-claim-missing');
});

test('지금 저장소 문서 — 새 위반 0(기존 위반은 docs/_meta/docs-meta-baseline.json 래칫)', () => {
  const { all, strict } = collect();
  const baseline: string[] = JSON.parse(readFileSync(join(DOCS, '_meta', 'docs-meta-baseline.json'), 'utf8')).violations;
  const r = evaluate(all, baseline, strict);
  assert.deepEqual(r.fresh.map(key), []);
  assert.ok(strict.has(REFDB), '30-95는 엄격 검사');
  for (const doc of [REFDB, '20-architecture/20-94-cost-estimation.md', '80-integration/80-50-alm-sync-jira-codebeamer.md', '80-integration/80-51-codebeamer-api-evidence.md'])
    assert.ok(!baseline.some((k) => k.startsWith(`${doc} |`)), `${doc}는 기준에 없어야 한다`);
});
