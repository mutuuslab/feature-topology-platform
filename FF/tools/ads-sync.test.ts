// ADS·UNECE 보고서 v3.0 카탈로그 — 원본 HTML은 저장소 밖이라, 시험은 작은 조각 HTML과 커밋된 catalog.json으로 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readJson } from './lib.ts';
import { CATALOG, REVIEW, catalogProblems, reviewProblems, text, verdictCounts, type AdsCatalog, type AdsReview } from './ads-sync.ts';
import { DESIGN, INSTRUCTION, declaredTables, designProblems, docCountProblems, mergeBacklog, nearDuplicate, type Design } from './ads-report.ts';

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

// ── 오류 주입: 검사기가 일부러 넣은 잘못을 모두 잡는지(검사기 자체의 검증) ──
test('오류 주입 — 근거 파일 없음·줄 초과·구현인데 시험 없음·결함 기록 없음·고친 결함을 모두 잡는다', () => {
  const c = readJson<AdsCatalog>(CATALOG);
  const r = readJson<AdsReview>(REVIEW);
  const id = c.requirements[0].id;
  const files: Record<string, string> = { 'a.ts': 'x\ny\n', 'p.spec.ts': `it.fails('${id} 재현', () => {});\n` };
  const read = (rel: string) => files[rel] ?? null;
  const base = Object.fromEntries(Object.keys(r.requirements).map((k) => [k, { verdict: '범위 밖' as const, evidence: [], gap: '', plan: [] }]));
  const tests = Object.fromEntries(Object.keys(r.tests).map((k) => [k, { status: '없음' as const, evidence: [], plan: [] }]));
  const sc = Object.fromEntries(Object.keys(r.scenarios).map((k) => [k, { current: '', gap: '', plan: [] }]));
  const run = (v: AdsReview['requirements'][string]) => reviewProblems(c, { source: r.source, requirements: { ...base, [id]: v }, tests, scenarios: sc }, read).join('\n');
  assert.equal(run({ verdict: '부분', evidence: ['a.ts:2'], gap: '', plan: ['X'] }), '');
  assert.match(run({ verdict: '부분', evidence: ['없는.ts:1'], gap: '', plan: ['X'] }), /근거 경로 없음/);
  assert.match(run({ verdict: '부분', evidence: ['a.ts:99'], gap: '', plan: ['X'] }), /근거 줄이 파일보다 김/);
  assert.match(run({ verdict: '구현', evidence: ['a.ts:1'], gap: '', plan: [] }), /시험이 없음/);
  assert.match(run({ verdict: '구현', evidence: ['a.ts:1'], tests: ['없는.spec.ts'], gap: '', plan: [] }), /시험 파일 없음/);
  assert.match(run({ verdict: '미구현', evidence: [], gap: '', plan: [] }), /반영 계획/);
  assert.equal(run({ verdict: '부분', evidence: ['a.ts:1'], gap: '', plan: ['X'], defect: { probe: 'p.spec.ts' } }), '');
  // 결함을 고쳐 it.fails를 it으로 바꿨는데 판정에 결함이 남아 있으면 잡는다
  files['p.spec.ts'] = `it('${id} 고침', () => {});\n`;
  assert.match(run({ verdict: '부분', evidence: ['a.ts:1'], gap: '', plan: ['X'], defect: { probe: 'p.spec.ts' } }), /it\.fails 기록이 없음/);
  // 줄 번호가 밀려 빈 줄·닫는 괄호를 가리키면 잡는다(주석·코드 줄은 인정)
  files['b.ts'] = 'const a = 1;\n\n  });\n// @rule FFG-X\n';
  assert.match(run({ verdict: '부분', evidence: ['b.ts:2'], gap: '', plan: ['X'] }), /내용이 없음/);
  assert.match(run({ verdict: '부분', evidence: ['b.ts:3'], gap: '', plan: ['X'] }), /내용이 없음/);
  assert.equal(run({ verdict: '부분', evidence: ['b.ts:1', 'b.ts:4'], gap: '', plan: ['X'] }), '');
});

test('오류 주입 — 선행 항목이 더 뒤 단계에 있거나, 같은 DB 테이블을 두 항목이 신설하면 잡는다', { skip: !existsSync(REVIEW) || !existsSync(DESIGN) }, () => {
  const c = readJson<AdsCatalog>(CATALOG);
  const r = readJson<AdsReview>(REVIEW);
  const d = readJson<Design>(DESIGN);
  const early = d.phases[1].items[0];
  const late = d.phases[d.phases.length - 1].items[0];
  const inverted = { ...d, items: d.items.map((i) => (i.id === early ? { ...i, deps: [...i.deps, late] } : i)) };
  assert.match(designProblems(c, r, inverted).join('\n'), new RegExp(`${early}\\(1단계\\)의 선행 ${late}가 더 뒤`));
  const owner = d.items.find((i) => i.db.length)!;
  const table = owner.db[0].split(/[\s(·]/)[0];
  const other = d.items.find((i) => i.id !== owner.id)!;
  const dup = { ...d, items: d.items.map((i) => (i.id === other.id ? { ...i, db: [...i.db, `${table} 신설`] } : i)) };
  assert.match(designProblems(c, r, dup).join('\n'), new RegExp(`DB ${table}를 .*함께 신설`));
});

test('오류 주입 — 결함 기록에 고칠 [결함] 설계 항목이 없거나, 단계 완료 조건의 결함 수가 항목 수와 다르면 잡는다', { skip: !existsSync(REVIEW) || !existsSync(DESIGN) }, () => {
  const c = readJson<AdsCatalog>(CATALOG);
  const d = readJson<Design>(DESIGN);
  // 커밋된 판정에 열린 결함이 없으면(모두 고침 — 2026-10-24 RD-FN-01) [결함] 설계 항목이 맡는 요건 하나에 결함 기록을 주입한다
  const base = readJson<AdsReview>(REVIEW);
  const open = Object.entries(base.requirements).find(([, v]) => v.defect)?.[0];
  const k = open ?? d.items.find((i) => i.defect && i.req.length)!.req[0];
  const r: AdsReview = open ? base : { ...base, requirements: { ...base.requirements, [k]: { ...base.requirements[k], defect: { probe: 'backend/test/ads/defects.spec.ts' } } } };
  const fixer = d.items.find((i) => i.defect && i.req.includes(k))!;
  const noFix = { ...d, items: d.items.map((i) => (i.id === fixer.id ? { ...i, req: i.req.filter((q) => q !== k) } : i)) };
  assert.match(designProblems(c, r, noFix).join('\n'), new RegExp(`${k} 결함을 고치는`));
  const n = d.items.filter((i) => i.defect).length;
  const drift = { ...d, phases: d.phases.map((p, i) => (i === 0 ? { ...p, exit: `${p.exit} · 결함 ${n + 1}건` } : p)) };
  assert.match(designProblems(c, r, drift).join('\n'), new RegExp(`결함 ${n + 1}건 ≠ \\[결함\\] 항목 ${n}개`));
});

test('오류 주입 — 문서의 판정 숫자·결함 수가 판정 파일과 다르면 잡는다', () => {
  const r = readJson<AdsReview>(REVIEW);
  const n = verdictCounts(r);
  const ok = `구현 ${n.구현} · 부분 ${n.부분} · 미구현 ${n.미구현} · 범위 밖 ${n['범위 밖']}, 결함 ${n.defects}건`;
  assert.deepEqual(docCountProblems(ok, 'doc.md', r), []);
  assert.match(docCountProblems(ok.replace(`구현 ${n.구현}`, `구현 ${n.구현 + 1}`), 'doc.md', r).join('\n'), /≠ 판정/);
  assert.match(docCountProblems(ok.replace(`결함 ${n.defects}건`, `결함 ${n.defects + 1}건`), 'doc.md', r).join('\n'), /결함/);
  assert.match(docCountProblems('숫자 없음', 'doc.md', r).join('\n'), /집계 문장이 없음/);
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

test('반영 실수 탐지 규칙 — 문장 중간 테이블·본문 지시문·거의 같은 문장', () => {
  assert.deepEqual(declaredTables('delivery_ack, safety_verdict, vehicle_feature_status 열 추가'), ['delivery_ack', 'safety_verdict']);
  assert.deepEqual(declaredTables('hazard_time_budget(hazard_id, detect_ms) 신설.'), ['hazard_time_budget']);
  assert.deepEqual(declaredTables('ownership_transfer.deletion_scope(PLATFORM)'), []);
  assert.deepEqual(declaredTables('entitlement에 binding 열'), []);
  for (const x of ['원인 분류 — deps ORC-BE08·ORC-UI09', '세션 결과 구분 — cases에 R02 추가', '멱등 주문 문장 삭제 — 멱등은 BE01', '시험을 SIM01 tests로 옮긴다', 'ORC-UI08, ORC-UI09 추가']) assert.match(x, INSTRUCTION, x);
  for (const x of ['DSSAD 기록은 차량 소관', '정책 게시본 추가 전달', '확대 보류 사유 표시']) assert.doesNotMatch(x, INSTRUCTION, x);
  assert.equal(nearDuplicate('defects.spec.ts FFP-F019 it.fails를 it로 전환.', '수정 후 backend/test/ads/defects.spec.ts FFP-F019 it.fails → it 전환(회귀 시험)'), true);
  assert.equal(nearDuplicate('종료 결과는 배타 구간', '주문 원장은 ORC-BE01'), false);
});

test('오류 주입 — 후속 교체 입력(later)이 없거나 같은·앞 단계, ui 문장의 모름 금지 표기', { skip: !existsSync(REVIEW) || !existsSync(DESIGN) }, () => {
  const c = readJson<AdsCatalog>(CATALOG);
  const r = readJson<AdsReview>(REVIEW);
  const d = readJson<Design>(DESIGN);
  const first = d.phases[1].items[0];
  const sibling = d.phases[1].items[1];
  const run = (patch: object) => designProblems(c, r, { ...d, items: d.items.map((i) => (i.id === first ? { ...i, ...patch } : i)) }).join('\n');
  assert.match(run({ later: ['ADS-ZZ99'] }), /후속 교체 입력 ADS-ZZ99가 없음/);
  assert.match(run({ later: [sibling] }), /같은·앞 단계 — deps로/);
  assert.match(run({ ui: ['상태 칸은 확인 불가로 표시'] }), /모름' 금지 표기/);
  assert.match(run({ be: ['원인 분류 — deps ORC-BE08'] }), /반영 지시문/);
});
