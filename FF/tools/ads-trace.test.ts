// ADS 요구 추적 생성 — 결함 기록(it.fails) 수집·검토 전 요구는 review null(화면에서 미판정)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAdsTrace, failsOf, renderAdsTrace } from './ads-trace.ts';

const CAT = {
  source: { file: 'r.html', sha256: 'a'.repeat(64), revision: '3.0', date: '2026-10-18' },
  requirements: [
    { id: 'FFP-F007', title: '승인 영향', category: '승인·변경 통제', priority: 'P0', owner: 'CP', content: 'c', acceptance: 'a', basis: 'GTR §5.2', tests: ['TC02'] },
    { id: 'FFP-F008', title: '미검토', category: '승인·변경 통제', priority: 'P1', owner: 'CP', content: 'c', acceptance: 'a', basis: 'GTR §5.3' },
  ],
  tests: [{ id: 'TC02', name: '변경', expected: 'e', requirements: ['FFP-F007'] }],
  scenarios: [{ id: 'S01', title: 's', situation: 'x', handling: 'y' }],
};
const REV = {
  source: { sha256: 'a'.repeat(64), reviewedAt: '2026-10-18', reviewedCommit: '0681305' },
  requirements: { 'FFP-F007': { verdict: '부분', evidence: ['x.ts:1'], defect: { probe: 'backend/test/ads/defects.spec.ts' } } },
  tests: { TC02: { status: '일부' } },
  scenarios: { S01: { current: 'now' } },
};

test('it.fails 제목의 요구 ID로 열린 결함을 모은다(파일:줄)', () => {
  const text = "it('FFP-F001 고친 결함', () => {});\r\n  it.fails('FFP-F007 승인 영향 — 출시 거부', async () => {});\n";
  assert.deepEqual(failsOf('backend/test/ads/defects.spec.ts', text), [{ reqId: 'FFP-F007', probe: 'backend/test/ads/defects.spec.ts:2', title: 'FFP-F007 승인 영향 — 출시 거부' }]);
});

test('검토 전 요구·시험은 review null — 화면은 미판정으로 보인다, 생성 모듈은 결정적', () => {
  const doc = buildAdsTrace(CAT, REV, [{ file: 'backend/test/ads/defects.spec.ts', text: "it.fails('FFP-F007 x', () => {});" }]);
  assert.equal(doc.requirements[0].review?.verdict, '부분');
  assert.equal(doc.requirements[0].defects.length, 1);
  assert.equal(doc.requirements[1].review, null);
  assert.deepEqual(doc.tests[0].review, { status: '일부', evidence: [], plan: [] });
  assert.equal(renderAdsTrace(doc), renderAdsTrace(buildAdsTrace(CAT, REV, [{ file: 'backend/test/ads/defects.spec.ts', text: "it.fails('FFP-F007 x', () => {});" }])));
});
