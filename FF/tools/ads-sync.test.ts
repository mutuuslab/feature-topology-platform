// ADS·UNECE 보고서 v3.0 카탈로그 — 원본 HTML은 저장소 밖이라, 시험은 작은 조각 HTML과 커밋된 catalog.json으로 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readJson } from './lib.ts';
import { CATALOG, REVIEW, catalogProblems, reviewProblems, text, type AdsCatalog, type AdsReview } from './ads-sync.ts';
import { DESIGN, designProblems, mergeBacklog, type Design } from './ads-report.ts';

test('HTML 조각을 글자로 — 태그·엔티티·공백 정리', () => {
  assert.equal(text('<b>FFP-F001</b> &amp; <a href="#H01">H01</a><br>시험'), 'FFP-F001 & H01 시험');
});

test('커밋된 카탈로그 — 요건 64·시험 24·위험 8·주장 6·시나리오 10·계약 4·API 5, 순서와 상호 참조가 맞다', () => {
  const c = readJson<AdsCatalog>(CATALOG);
  assert.deepEqual(catalogProblems(c), []);
  assert.equal(c.vision.thesis, '플랫폼은 승인된 정책을 관리하고, 차량이 현재 상태의 실행 가능성을 판단한다.');
  assert.equal(c.requirements.filter((r) => r.priority === 'P0').length, 45);
  // 시나리오는 상황·처리·근거를 모두 가진다
  for (const s of c.scenarios) assert.ok(s.situation && s.handling && s.basis, s.id);
});

test('무결성 검사는 빠진 요건·끊어진 참조를 잡는다', () => {
  const c = readJson<AdsCatalog>(CATALOG);
  const broken: AdsCatalog = { ...c, requirements: c.requirements.slice(1), tests: c.tests.map((t, i) => (i ? t : { ...t, requirements: ['FFP-F999'] })) };
  const p = catalogProblems(broken).join('\n');
  assert.match(p, /기능요건 63개/);
  assert.match(p, /FFP-F999/);
});

test('review.json — 모든 요건·시험·시나리오에 판정, 구현·부분은 근거 경로, 미구현·부분은 Backlog ID', { skip: !existsSync(REVIEW) }, () => {
  const c = readJson<AdsCatalog>(CATALOG);
  assert.deepEqual(reviewProblems(c, readJson<AdsReview>(REVIEW)), []);
});

test('설계 — 판정의 계획 ID가 모두 설계 항목이고, 항목은 모두 어느 단계에 있다', { skip: !existsSync(REVIEW) || !existsSync(DESIGN) }, () => {
  const c = readJson<AdsCatalog>(CATALOG);
  const r = readJson<AdsReview>(REVIEW);
  const d = readJson<Design>(DESIGN);
  assert.deepEqual(designProblems(c, r, d), []);
  const broken = { ...d, items: d.items.filter((i) => i.id !== 'ADS-BE03') };
  assert.match(designProblems(c, r, broken).join('\n'), /ADS-BE03가 설계에 없음/);
});

test('Backlog 절은 표식 사이만 바꾸고 나머지 내용은 그대로 둔다', () => {
  const head = '# Backlog\n\n## 텔레메트리\n- TL-UI01\n';
  const once = mergeBacklog(head, '<!-- ads:begin x -->\nA\n<!-- ads:end -->');
  assert.ok(once.startsWith(head.trimEnd()));
  const twice = mergeBacklog(once, '<!-- ads:begin x -->\nB\n<!-- ads:end -->');
  assert.match(twice, /TL-UI01/);
  assert.match(twice, /\nB\n/);
  assert.doesNotMatch(twice, /\nA\n/);
});
