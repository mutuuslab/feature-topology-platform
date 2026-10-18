// 하네스 멤버 검토 검사기 시험 — 작은 가짜 설계·검토로 각 규칙이 잘못을 잡는지(결함 주입) 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { FILES, candidates, copyProblems, fitProblems, itemSha, routePaths, teamProblems, uxProblems, workflowProblems, type DItem, type Fit, type Ux, type UxItem, type Wf, type Workflows } from './ads-team.ts';

const item = (id: string, extra: Partial<DItem> = {}): DItem => ({ id, req: ['FFP-F001'], ui: ['/fleet/live 상태 분포'], fe: [], be: [], ...extra });

test('설계 항목 해시 — 키 순서와 무관, 내용이 바뀌면 달라진다', () => {
  const a = item('X');
  assert.equal(itemSha(a), itemSha({ be: [], fe: [], ui: a.ui, req: a.req, id: 'X' }));
  assert.notEqual(itemSha(a), itemSha({ ...a, be: ['새 줄'] }));
});

test('화면 문구 — 코드·단정 표현·금지 용어를 잡는다', () => {
  assert.deepEqual(copyProblems('k', '종료 확인 80 · 미확인 12'), []);
  assert.match(copyProblems('k', 'FFG-PLT-005 위반').join(), /코드/);
  assert.match(copyProblems('k', '문제가 생기면 즉시 끕니다').join(), /종료 요청/);
  assert.match(copyProblems('k', '복원 뒤 자동으로 활성됩니다').join(), /복원 ≠ 활성화/);
  assert.match(copyProblems('k', '차량 트윈 화면').join(), /Digital Twin/);
  assert.match(copyProblems('k', '증적 묶음').join(), /Evidence/);
});

test('라우트 경로 추출', () => {
  assert.deepEqual(routePaths("[{ path: '/a', x }, { path: '/b/:id', y }]"), ['/a', '/b/:id']);
});

const goodUx = (i: DItem): UxItem => ({
  sha: itemSha(i),
  screens: [{ path: '/fleet/live', kind: 'modify' }],
  keyMessage: '적용 확인 80 · 미확인 12',
  lead: '차량이 보고한 실제 상태와 정책 의도를 나눠 봅니다',
  states: { normal: '분포', empty: '대상 없음', unknown: '판단 불가 5대', error: '불러오지 못함', noPermission: '권한 없음 — 사유' },
  primaryAction: { label: '미확인 차량 보기', blockedReason: '대상 없음' },
  components: ['분포 막대'],
  a11y: ['색 + 글자'],
  findings: [],
  verdict: '통과',
});
const ux = (i: DItem, u: Partial<UxItem> = {}): Ux => ({ member: 'UI/UX', method: '', reviewedAt: '', components: { '분포 막대': { purpose: '', existing: null, usedBy: [i.id] } }, items: { [i.id]: { ...goodUx(i), ...u } }, crossCutting: [] });

test('결함 주입 — UI/UX 디자이너 검토', () => {
  const i = item('ADS-UI99');
  const routes = ['/fleet/live'];
  const run = (u: Partial<UxItem>, it = i) => uxProblems([it], ux(i, u), routes, () => null).join('\n');
  assert.equal(run({}), '');
  assert.match(uxProblems([i], { ...ux(i), items: {} }, routes, () => null).join(), /검토 없음/);
  assert.match(run({}, { ...i, be: ['설계가 바뀜'] }), /옛 설계 판/);
  assert.match(run({ screens: [{ path: '/없는/화면', kind: 'modify' }] }), /라우트에 없음/);
  assert.match(run({ screens: [{ path: '/fleet/live', kind: 'new' }] }), /이미 라우트에 있음/);
  assert.match(run({ lead: '가'.repeat(71) }), /70자 이하/);
  assert.match(run({ states: { ...goodUx(i).states, unknown: null } }), /판단 불가/);
  assert.match(run({ states: { ...goodUx(i).states, noPermission: null } }), /권한 없음/);
  assert.match(run({ primaryAction: { label: '보기', blockedReason: null } }), /막혔을 때/);
  assert.match(run({ components: ['없는 부품'] }), /정의 없음/);
  assert.match(run({ keyMessage: '이상 차량은 즉시 끕니다' }), /종료 요청/);
  assert.match(run({ findings: [{ severity: 'blocker', issue: '핵심 메시지 후보 둘', fix: '하나로' }] }), /열린 blocker/);
  assert.equal(run({ findings: [{ severity: 'blocker', issue: '핵심 메시지 후보 둘', fix: '하나로', status: 'resolved', resolution: '설계 ui 1줄 수정' }] }), '');
});

const W: Workflows = {
  roles: [{ id: 'R-OPS' }, { id: 'R-SM' }],
  processes: [
    {
      id: 'FPW.8',
      activities: [
        { id: 'FPW.8-A10', name: '단계적 복원', rules: ['FFG-LCY-009'], steps: ['복원 뒤 활성으로 돌아왔는지 확인한다'], checks: [], raci: { R: ['R-OPS'], A: 'R-OPS', C: [], I: [] }, platform: { actions: [], screens: ['/fleet/live'] } },
        { id: 'FPW.8-A01', name: '이상 징후', rules: [], steps: ['확인'], checks: [], raci: { R: ['R-OPS'], A: 'R-OPS', C: [], I: [] }, platform: { actions: [], screens: ['/ops/anomalies'] } },
      ],
    },
  ],
};
const rulesOf = (q: string) => (q === 'FFP-F001' ? ['FFG-LCY-009'] : []);
const clash = { activity: 'FPW.8-A10', text: '복원 뒤 활성으로 돌아왔는지 확인한다', principle: '복원 ≠ 활성화', designItem: 'ADS-UI99', fix: '…' };
const wf = (i: DItem, v: Partial<Wf['items'][string]> = {}, extra: Partial<Wf> = {}): Wf => ({
  member: '',
  method: '',
  reviewedAt: '',
  items: { [i.id]: { sha: itemSha(i), activities: [{ id: 'FPW.8-A10', change: 'modify', what: '재판정' }], newActivities: [], dismissed: [], newProcess: null, none: false, noneWhy: null, ...v } },
  conflicts: [clash],
  newRoles: [],
  newProcesses: [],
  ...extra,
});

test('결함 주입 — 업무 절차 담당 검토', () => {
  const i = item('ADS-UI99');
  assert.deepEqual(candidates(i, rulesOf, W.processes[0].activities), ['FPW.8-A10']);
  const run = (v: Partial<Wf['items'][string]> = {}, extra: Partial<Wf> = {}) => workflowProblems([i], wf(i, v, extra), W, rulesOf).join('\n');
  assert.equal(run(), '');
  assert.match(run({ activities: [] }), /자동 후보 FPW.8-A10를 검토하지 않음/);
  assert.equal(run({ activities: [], dismissed: [{ id: 'FPW.8-A10', why: '무관' }], newProcess: '새 절차' }), '');
  assert.match(run({ activities: [{ id: 'FPW.8-A99', change: 'modify', what: '' }] }), /없는 활동 FPW.8-A99/);
  assert.match(run({ newActivities: [{ process: 'FPW.8', name: '재판정', raci: { R: ['R-NOPE'], A: 'R-SM', C: [], I: [] }, why: '' }] }), /역할 R-NOPE/);
  assert.match(run({}, { conflicts: [] }), /문장 충돌 미기록 FPW.8-A10/);
  assert.match(run({ none: true, activities: [] , dismissed: [{ id: 'FPW.8-A10', why: '' }] }), /이유가 없음/);
});

test('결함 주입 — 설계 적합성 검토', () => {
  const i = item('ADS-BE99', { req: ['FFP-F001'] });
  const rv = { ads: { 'FFP-F001': { verdict: '부분', plan: ['ADS-BE99'] } }, orca: {} };
  const entry = (e: Partial<Fit['ads'][string]> = {}) => ({ shas: { 'ADS-BE99': itemSha(i) }, covers: 'yes' as const, missing: null, suggest: [], testPlanned: true, ...e });
  const run = (e: Partial<Fit['ads'][string]> = {}, it = i) => fitProblems([it], { method: '', reviewedAt: '', ads: { 'FFP-F001': entry(e) }, orca: {}, itemIssues: [] }, rv).join('\n');
  assert.equal(run(), '');
  assert.match(fitProblems([i], { method: '', reviewedAt: '', ads: {}, orca: {}, itemIssues: [] }, rv).join(), /검토 없음/);
  assert.match(run({}, { ...i, be: ['바뀜'] }), /옛 설계 판/);
  assert.match(run({ covers: 'no', missing: '종료 확인 없음' }), /닫지 못함/);
  assert.match(run({ covers: 'partial', missing: '일부', suggest: [{ item: 'ADS-BE99', field: 'be', text: '추가' }] }), /처리 안 한 제안/);
  assert.equal(run({ covers: 'partial', missing: '일부', suggest: [{ item: 'ADS-BE99', field: 'be', text: '추가', status: 'applied' }] }), '');
  assert.match(run({ covers: 'partial', missing: '일부', suggest: [{ item: 'ADS-BE99', field: 'be', text: '추가', status: 'declined' }] }), /이유가 없음/);
});

test('커밋된 멤버 검토가 모두 최신이고 열린 blocker가 없다', { skip: !existsSync(FILES.ux) || !existsSync(FILES.workflow) || !existsSync(FILES.fit) }, () => {
  assert.deepEqual(teamProblems(), []);
});

test('결함 주입 — 바꾸기·지우기 제안은 대상 문장(target)이 있어야 한다', () => {
  const i = item('ADS-BE99', { req: ['FFP-F001'] });
  const rv = { ads: { 'FFP-F001': { verdict: '부분', plan: ['ADS-BE99'] } }, orca: {} };
  const fit = (s: Fit['ads'][string]['suggest'][number]) => fitProblems([i], { method: '', reviewedAt: '', ads: { 'FFP-F001': { shas: { 'ADS-BE99': itemSha(i) }, covers: 'partial', missing: '일부', suggest: [s], testPlanned: true } }, orca: {}, itemIssues: [] }, rv).join('\n');
  assert.match(fit({ item: 'ADS-BE99', field: 'be', text: '새 문장', op: 'replace', status: 'applied' }), /대상 문장\(target\)이 없음/);
  assert.doesNotMatch(fit({ item: 'ADS-BE99', field: 'be', text: '새 문장', op: 'replace', target: '옛 문장', status: 'applied' }), /target/);
});
