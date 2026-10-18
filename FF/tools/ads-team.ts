// 하네스 멤버 검토 — ADS·Orca 설계(design.json)를 구현 전에 여러 역할이 검토하고, 그 결과를 기계가 검사한다.
// 멤버: UI/UX 디자이너(ux.json) · 업무 절차 담당(workflow.json) · 설계 적합성 검토 ADS·Orca(fit.json).
// (코드 대조 판정·적대적 재검증 멤버의 산출물은 review.json — ads-sync가 검사한다.)
// 검토 신선도: 검토마다 대상 설계 항목의 해시를 남긴다. 설계를 고치면 그 항목은 다시 검토할 때까지 verify가 실패한다.
//   node tools/ads-team.ts --check              검사
//   node tools/ads-team.ts --stale              다시 검토할 항목 목록
//   node tools/ads-team.ts --import <ux|workflow|fit-ads|fit-orca> <멤버 출력 json>   지금 설계 판으로 해시를 찍어 harness에 저장
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FF, readJson } from './lib.ts';

const H = join(FF, 'harness', 'ads');
export const FILES = { ux: join(H, 'ux.json'), workflow: join(H, 'workflow.json'), fit: join(H, 'fit.json') };
const DESIGN = join(H, 'design.json');
const REVIEW = join(H, 'review.json');
const ORCA_REVIEW = join(FF, 'harness', 'orca', 'review.json');
const WORKFLOWS = join(FF, '..', 'docs', '65-workflows', 'out', 'workflows.json');
const ROUTES = join(FF, 'frontend', 'src', 'routes.tsx');

// ── 입력 모양(필요한 필드만) ──
export interface DItem {
  id: string;
  req: string[];
  ui: string[];
  fe: string[];
  be: string[];
  cases?: string[];
  [k: string]: unknown;
}
interface Activity {
  id: string;
  name: string;
  rules: string[];
  steps: string[];
  checks: string[];
  raci: { R: string[]; A: string; C: string[]; I: string[] };
  platform: { actions: string[]; screens: string[] };
}
export interface Workflows {
  roles: { id: string }[];
  processes: { id: string; activities: Activity[] }[];
}

/** 설계 항목 해시 — 키 순서와 무관한 정규 JSON의 sha256 앞 12자 */
export function itemSha(i: unknown): string {
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
  return createHash('sha256').update(JSON.stringify(canon(i))).digest('hex').slice(0, 12);
}

// ── 공통 문구 규칙(화면 문구 초안) ──
/** 화면 문구에 쓰지 않는 코드 — three-second.spec ⑤와 같은 정규식 + 요건 ID */
export const CODE = /FFG-[A-Z]+-\d|\bIF-\d|\bD0\d-\d|\bFFP-F\d|보고서 \d|§\d/;
/** 단정·오인 표현 — ADS 원칙과 Orca 표현 경계(사례 video.limit)에서 뽑은 것, 용어 금지어 */
export const FORBIDDEN: [RegExp, string][] = [
  [/즉시\s*(끕|꺼|끄)/, '종료 요청 ≠ 종료 완료 — "즉시 끈다" 단정 금지'],
  [/알아서\s*되돌|저절로\s*(복구|되돌)/, '복원은 승인·검증 절차 — 자동 복구 단정 금지'],
  [/(복원|해제)\S*\s*(뒤|후)?\s*자동\S*\s*활성/, '복원 ≠ 활성화'],
  [/전\s*세계\s*동시|모든\s*(구형|차량에서)/, '시장·차종별 승인 범위 — 일괄 단정 금지'],
  [/트윈|Digital Twin|\bTwin\b/i, '용어 금지(Digital Twin) — 업무 용어로'],
  [/증적/, "'증적' 대신 'Evidence'"],
  [/확인 불가|판정 불명|판단 보류/, "'모름' 표기는 둘만 — 판단 불가(판정 UNKNOWN·근거 부족) · 미확인(관측 없음·기준 시간 초과)"],
];
export function copyProblems(where: string, text: string | null | undefined): string[] {
  if (!text) return [];
  const p: string[] = [];
  if (CODE.test(text)) p.push(`${where}: 화면 문구에 코드가 있음 — "${text.slice(0, 60)}"`);
  for (const [re, why] of FORBIDDEN) if (re.test(text)) p.push(`${where}: ${why} — "${text.slice(0, 60)}"`);
  return p;
}

// ── 라우트 ──
export const routePaths = (src: string) => [...src.matchAll(/\{ path: '([^']+)'/g)].map((m) => m[1]);

// ── UI/UX 디자이너 ──
type Sev = 'blocker' | 'major' | 'minor';
export interface UxItem {
  sha: string;
  screens: { path: string; kind: 'modify' | 'new' | 'all' }[];
  keyMessage: string;
  lead: string;
  states: { normal: string | null; empty: string | null; unknown: string | null; error: string | null; noPermission: string | null };
  primaryAction: { label: string; blockedReason: string | null; readOnly?: boolean } | null;
  components: string[];
  a11y: string[];
  findings: { severity: Sev; issue: string; fix: string; status?: 'open' | 'accepted' | 'resolved'; resolution?: string }[];
  verdict: '통과' | '수정 필요';
}
export interface Ux {
  member: string;
  method: string;
  reviewedAt: string;
  components: Record<string, { purpose: string; existing: string | null; usedBy: string[] }>;
  items: Record<string, UxItem>;
  crossCutting: { severity: Sev; issue: string; fix: string; items: string[]; status?: 'open' | 'accepted' | 'resolved'; resolution?: string }[];
}
/** 화면을 그리는 설계 항목 = ui가 비어 있지 않은 항목 */
export const uiItems = (items: DItem[]) => items.filter((i) => i.ui.length);
const STATEFUL = /상태|판정|확인|적용|수신|관측|활성/;

export function uxProblems(items: DItem[], ux: Ux, routes: string[], read: (p: string) => string | null): string[] {
  const p: string[] = [];
  const known = new Set(routes);
  for (const i of uiItems(items)) {
    const u = ux.items[i.id];
    if (!u) {
      p.push(`UX ${i.id} 검토 없음`);
      continue;
    }
    if (u.sha !== itemSha(i)) p.push(`UX ${i.id} 검토가 옛 설계 판 기준(${u.sha} ≠ ${itemSha(i)}) — 다시 검토`);
    if (!u.screens.length) p.push(`UX ${i.id} 대상 화면 없음`);
    for (const s of u.screens) {
      if (s.kind === 'modify' && !known.has(s.path)) p.push(`UX ${i.id} 고치는 화면 ${s.path}가 라우트에 없음`);
      if (s.kind === 'new' && known.has(s.path)) p.push(`UX ${i.id} 신설 화면 ${s.path}가 이미 라우트에 있음 — modify로`);
    }
    const all = u.screens.some((s) => s.kind === 'all');
    if (!all && !u.keyMessage?.trim()) p.push(`UX ${i.id} 핵심 메시지 없음`);
    if ((u.lead ?? '').length > 70) p.push(`UX ${i.id} 머리 설명 ${u.lead.length}자 — 70자 이하(3초 규칙 ⑤)`);
    if (STATEFUL.test(i.ui.join(' ')) && !u.states.unknown) p.push(`UX ${i.id} 상태를 보이는 화면인데 '판단 불가·미확인' 표시가 없음`);
    const acts = u.primaryAction && !u.primaryAction.readOnly;
    if (acts && !u.states.noPermission) p.push(`UX ${i.id} 바꾸는 행동이 있는데 권한 없음 상태가 없음(읽기 전용이면 readOnly)`);
    if (acts && !u.primaryAction!.blockedReason) p.push(`UX ${i.id} 바꾸는 행동이 막혔을 때 보일 사유가 없음`);
    for (const c of u.components) {
      const def = ux.components[c];
      if (!def) p.push(`UX ${i.id} 공통 부품 ${c} 정의 없음`);
      else if (!def.usedBy.includes(i.id)) p.push(`UX 공통 부품 ${c}의 usedBy에 ${i.id}가 없음`);
    }
    const texts: [string, string | null | undefined][] = [
      ['핵심 메시지', u.keyMessage],
      ['머리 설명', u.lead],
      ...Object.entries(u.states).map(([k, v]) => [`상태 ${k}`, v] as [string, string | null]),
      ['행동', u.primaryAction?.label],
      ['막힘 사유', u.primaryAction?.blockedReason],
    ];
    for (const [w, t] of texts) p.push(...copyProblems(`UX ${i.id} ${w}`, t));
    for (const f of u.findings) if (f.severity === 'blocker' && f.status !== 'resolved') p.push(`UX ${i.id} 열린 blocker — ${f.issue.slice(0, 80)}`);
    for (const f of u.findings) if ((f.status === 'resolved' || f.status === 'accepted') && !f.resolution) p.push(`UX ${i.id} ${f.status} 표시인데 내용 없음 — ${f.issue.slice(0, 50)}`);
    for (const f of u.findings) if (f.severity === 'major' && (!f.status || f.status === 'open')) p.push(`UX ${i.id} major 미분류(accepted=구현 때 따름 / resolved=설계 반영) — ${f.issue.slice(0, 60)}`);
  }
  for (const [c, def] of Object.entries(ux.components)) {
    if (def.existing && read(def.existing) === null) p.push(`UX 공통 부품 ${c}: 기존 파일 ${def.existing} 없음`);
    for (const id of def.usedBy) if (!ux.items[id]?.components.includes(c)) p.push(`UX 공통 부품 ${c}: ${id}가 이 부품을 쓰지 않음`);
  }
  for (const x of ux.crossCutting) if (x.severity === 'blocker' && x.status !== 'resolved') p.push(`UX 공통 blocker — ${x.issue.slice(0, 80)}`);
  for (const x of ux.crossCutting) if (x.severity === 'major' && (!x.status || x.status === 'open')) p.push(`UX 공통 major 미분류 — ${x.issue.slice(0, 60)}`);
  for (const x of ux.crossCutting) if ((x.status === 'resolved' || x.status === 'accepted') && !x.resolution) p.push(`UX 공통 ${x.status} 표시인데 내용 없음 — ${x.issue.slice(0, 50)}`);
  for (const k of Object.keys(ux.items)) if (!uiItems(items).some((i) => i.id === k)) p.push(`UX 검토 키 ${k}가 화면 설계 항목이 아님`);
  return p;
}

// ── 업무 절차 담당 ──
export interface WfItem {
  sha: string;
  activities: { id: string; change: 'modify' | 'remove'; what: string }[];
  newActivities: { process: string; name: string; raci: { R: string[]; A: string; C: string[]; I: string[] }; why: string }[];
  dismissed: { id: string; why: string }[];
  newProcess: string | null;
  none: boolean;
  noneWhy: string | null;
}
export interface Wf {
  member: string;
  method: string;
  reviewedAt: string;
  items: Record<string, WfItem>;
  conflicts: { activity: string; text: string; principle: string; designItem: string; fix: string }[];
  newRoles: { name: string; why: string; items: string[] }[];
  newProcesses: { name: string; items: string[]; roles: string[] }[];
}
const paths = (xs: string[]) => [...new Set(xs.join(' ').match(/\/[a-z][a-z0-9/:_-]*/g) ?? [])];
const norm = (s: string) => s.replace(/:[a-z]+/g, ':x').replace(/\/$/, '');
/** 자동 후보 — 설계 항목 요건의 FFG 규칙 또는 화면 경로가 활동과 겹친다 */
export function candidates(i: DItem, rulesOf: (req: string) => string[], acts: Activity[]): string[] {
  const rules = new Set(i.req.flatMap(rulesOf));
  const scr = paths([...i.ui, ...i.fe]).map(norm);
  return acts.filter((a) => a.rules.some((r) => rules.has(r)) || a.platform.screens.some((s) => scr.some((x) => norm(s) === x || x.startsWith(`${norm(s)}/`)))).map((a) => a.id);
}
/** 절차 문장이 원칙과 부딪히는 곳(자동 탐지) — 목록에 없으면 실패 */
export const PRINCIPLE_CLASH: [RegExp, string][] = [
  [/복원.*활성으로 돌아|복원.*자동.{0,6}활성/, '복원 ≠ 활성화'],
  [/결제.*(사용 가능|활성).*(완료|확정)/, '결제 성공 ≠ 사용 준비 완료'],
];
export function workflowProblems(items: DItem[], wf: Wf, w: Workflows, rulesOf: (req: string) => string[]): string[] {
  const p: string[] = [];
  const acts = w.processes.flatMap((x) => x.activities);
  const ids = new Set(acts.map((a) => a.id));
  const procs = new Set(w.processes.map((x) => x.id));
  const roles = new Set(w.roles.map((r) => r.id));
  const newRoles = new Set(wf.newRoles.map((r) => `NEW:${r.name}`));
  const newProcs = new Set(wf.newProcesses.map((x) => `NEW:${x.name}`));
  for (const i of items) {
    const v = wf.items[i.id];
    if (!v) {
      p.push(`절차 ${i.id} 검토 없음`);
      continue;
    }
    if (v.sha !== itemSha(i)) p.push(`절차 ${i.id} 검토가 옛 설계 판 기준 — 다시 검토`);
    for (const a of v.activities) if (!ids.has(a.id)) p.push(`절차 ${i.id}: 없는 활동 ${a.id}`);
    for (const a of v.dismissed) if (!ids.has(a.id)) p.push(`절차 ${i.id}: 없는 활동 ${a.id}(제외 목록)`);
    for (const n of v.newActivities) {
      if (!procs.has(n.process) && !newProcs.has(n.process)) p.push(`절차 ${i.id}: 새 활동의 절차 ${n.process} 없음`);
      for (const r of [...n.raci.R, n.raci.A, ...n.raci.C, ...n.raci.I]) if (!roles.has(r) && !newRoles.has(r)) p.push(`절차 ${i.id}: 새 활동 '${n.name}'의 역할 ${r}가 역할 목록·새 역할 후보에 없음`);
    }
    const seen = new Set([...v.activities.map((a) => a.id), ...v.dismissed.map((a) => a.id)]);
    for (const c of candidates(i, rulesOf, acts)) if (!seen.has(c)) p.push(`절차 ${i.id}: 자동 후보 ${c}를 검토하지 않음(activities 또는 dismissed)`);
    if (v.none && (v.activities.length || v.newActivities.length)) p.push(`절차 ${i.id}: 영향 없음인데 활동이 있음`);
    if (!v.none && !v.activities.length && !v.newActivities.length && !v.newProcess) p.push(`절차 ${i.id}: 바뀌는 활동·새 활동·새 절차·영향 없음 중 하나는 있어야 함`);
    if (v.none && !v.noneWhy) p.push(`절차 ${i.id}: 영향 없음의 이유가 없음`);
  }
  for (const a of acts)
    for (const t of [...a.steps, ...a.checks])
      for (const [re, why] of PRINCIPLE_CLASH)
        if (re.test(t) && !wf.conflicts.some((c) => c.activity === a.id && c.text === t)) p.push(`절차 문장 충돌 미기록 ${a.id}(${why}): ${t.slice(0, 60)}`);
  for (const c of wf.conflicts) {
    const a = acts.find((x) => x.id === c.activity);
    if (!a) p.push(`절차 충돌: 없는 활동 ${c.activity}`);
    if (!items.some((i) => i.id === c.designItem)) p.push(`절차 충돌 ${c.activity}: 없는 설계 항목 ${c.designItem}`);
  }
  for (const k of Object.keys(wf.items)) if (!items.some((i) => i.id === k)) p.push(`절차 검토 키 ${k}가 설계에 없음`);
  return p;
}
/** 고친 절차 문장이 모델에 반영됐는지 — 아직 남아 있는 충돌(그 세션 몫) */
export const openConflicts = (wf: Wf, w: Workflows) => wf.conflicts.filter((c) => w.processes.flatMap((x) => x.activities).find((a) => a.id === c.activity && [...a.steps, ...a.checks].includes(c.text)));

// ── 설계 적합성 검토 ──
export interface FitEntry {
  shas: Record<string, string>;
  covers: 'yes' | 'partial' | 'no';
  missing: string | null;
  /** op — add(덧붙이기) · replace(target 문장을 text로) · remove(target 문장 삭제) · dep · case · later(배열에 item ID).
   *  2026-10-18 1~3회차에 "바꾼다" 제안을 덧붙이기로 반영해 옛 문장·지시문 꼬리가 남았다 — 이제 replace·remove는 target 필수 */
  suggest: { item: string; field: string; text: string; op?: 'add' | 'replace' | 'remove' | 'dep' | 'case' | 'later'; target?: string; status?: 'open' | 'applied' | 'declined'; note?: string }[];
  testPlanned: boolean;
  scope?: string | null;
  limitRisk?: string | null;
}
export interface Fit {
  method: string;
  reviewedAt: string;
  ads: Record<string, FitEntry>;
  orca: Record<string, FitEntry>;
  itemIssues: { item: string; issue: string; fix: string; status?: 'open' | 'applied' | 'declined'; note?: string }[];
}
interface Reviews {
  ads: Record<string, { verdict: string; plan: string[] }>;
  orca: Record<string, { verdict: string; plan: string[] }>;
}
/** 요건(키)에 연결된 설계 항목 — 판정의 계획 ID ∪ 항목의 req·cases */
export function linked(key: string, plan: string[], items: DItem[]): DItem[] {
  return items.filter((i) => plan.includes(i.id) || i.req.includes(key) || i.cases?.includes(key));
}
export function fitProblems(items: DItem[], fit: Fit, rv: Reviews): string[] {
  const p: string[] = [];
  const open = (s: { status?: string }) => !s.status || s.status === 'open';
  const run = (kind: 'ads' | 'orca', src: Reviews['ads'], got: Record<string, FitEntry>) => {
    for (const [k, v] of Object.entries(src)) {
      if (v.verdict !== '부분' && v.verdict !== '미구현') continue;
      const f = got[k];
      if (!f) {
        p.push(`적합성 ${k} 검토 없음`);
        continue;
      }
      const now = Object.fromEntries(linked(k, v.plan, items).map((i) => [i.id, itemSha(i)]));
      const stale = Object.keys(now).length !== Object.keys(f.shas).length || Object.entries(now).some(([id, s]) => f.shas[id] !== s);
      if (stale) p.push(`적합성 ${k} 검토가 옛 설계 판 기준(연결 항목이 바뀜) — 다시 검토`);
      else if (f.covers === 'no') p.push(`적합성 ${k}: 설계가 합격 조건을 닫지 못함 — ${(f.missing ?? '').slice(0, 80)}`);
      if (f.covers !== 'yes' && !f.missing) p.push(`적합성 ${k}: 빠진 것 설명 없음`);
      for (const s of f.suggest) if (s.status === 'declined' && !s.note) p.push(`적합성 ${k}: 제안을 받지 않은 이유가 없음`);
      for (const s of f.suggest) if ((s.op === 'replace' || s.op === 'remove') && !s.target) p.push(`적합성 ${k}: ${s.op} 제안에 대상 문장(target)이 없음 — 덧붙이기로 반영되면 옛 문장이 남는다`);
      if (!stale && f.covers !== 'yes' && f.suggest.some(open)) p.push(`적합성 ${k}: 처리 안 한 제안 ${f.suggest.filter(open).length}개(applied/declined로)`);
    }
    for (const k of Object.keys(got)) if (!src[k]) p.push(`적합성 키 ${k}가 ${kind} 판정에 없음`);
  };
  run('ads', rv.ads, fit.ads);
  run('orca', rv.orca, fit.orca);
  for (const x of fit.itemIssues) if (open(x)) p.push(`적합성 항목 문제 미처리 ${x.item} — ${x.issue.slice(0, 60)}`);
  return p;
}

// ── 묶음 ──
const read = (rel: string) => (existsSync(join(FF, rel)) ? readFileSync(join(FF, rel), 'utf8') : null);
function load() {
  const d = readJson<{ items: DItem[] }>(DESIGN);
  const r = readJson<{ requirements: Record<string, { verdict: string; plan: string[]; rules?: string[] }> }>(REVIEW);
  const o = readJson<{ items: Record<string, { verdict: string; plan: string[] }> }>(ORCA_REVIEW);
  const w = readJson<Workflows>(WORKFLOWS);
  const rulesOf = (q: string) => r.requirements[q]?.rules ?? [];
  return { items: d.items, r, o, w, rulesOf, routes: routePaths(readFileSync(ROUTES, 'utf8')) };
}
export function teamProblems(): string[] {
  const L = load();
  const p: string[] = [];
  if (!existsSync(FILES.ux)) p.push('UI/UX 디자이너 검토 없음(harness/ads/ux.json)');
  else p.push(...uxProblems(L.items, readJson<Ux>(FILES.ux), L.routes, read));
  if (!existsSync(FILES.workflow)) p.push('업무 절차 검토 없음(harness/ads/workflow.json)');
  else p.push(...workflowProblems(L.items, readJson<Wf>(FILES.workflow), L.w, L.rulesOf));
  if (!existsSync(FILES.fit)) p.push('설계 적합성 검토 없음(harness/ads/fit.json)');
  else p.push(...fitProblems(L.items, readJson<Fit>(FILES.fit), { ads: L.r.requirements, orca: L.o.items }));
  return p;
}

/** 멤버 출력(.sim)을 지금 설계 판 해시와 함께 harness에 저장 — 검토가 끝난 직후에만 쓴다 */
function importMember(kind: string, file: string, at: string) {
  const L = load();
  const src = JSON.parse(readFileSync(file, 'utf8'));
  const byId = new Map(L.items.map((i) => [i.id, i]));
  const stamp = (id: string) => itemSha(byId.get(id) ?? (() => { throw new Error(`설계에 없는 항목 ${id}`); })());
  if (kind === 'ux') {
    for (const [id, v] of Object.entries<UxItem>(src.items)) v.sha = stamp(id);
    writeFileSync(FILES.ux, `${JSON.stringify({ member: src.member, method: src.method, reviewedAt: at, components: src.components, items: src.items, crossCutting: src.crossCutting ?? [] }, null, 2)}\n`);
  } else if (kind === 'workflow') {
    for (const [id, v] of Object.entries<WfItem>(src.items)) v.sha = stamp(id);
    writeFileSync(FILES.workflow, `${JSON.stringify({ member: src.member, method: src.method, reviewedAt: at, items: src.items, conflicts: src.conflicts ?? [], newRoles: src.newRoles ?? [], newProcesses: src.newProcesses ?? [], roleSummary: src.roleSummary ?? {} }, null, 2)}\n`);
  } else if (kind === 'fit-ads' || kind === 'fit-orca') {
    const fit: Fit = existsSync(FILES.fit) ? readJson<Fit>(FILES.fit) : { method: '', reviewedAt: at, ads: {}, orca: {}, itemIssues: [] };
    const which = kind === 'fit-ads' ? 'ads' : 'orca';
    const plans = which === 'ads' ? L.r.requirements : L.o.items;
    const entries: Record<string, FitEntry> = which === 'ads' ? src.requirements : src.items;
    for (const [k, v] of Object.entries(entries)) v.shas = Object.fromEntries(linked(k, plans[k]?.plan ?? [], L.items).map((i) => [i.id, itemSha(i)]));
    fit[which] = { ...fit[which], ...entries };
    fit.itemIssues = [...fit.itemIssues.filter((x) => !(src.itemIssues ?? []).some((y: { item: string; issue: string }) => y.item === x.item && y.issue === x.issue)), ...(src.itemIssues ?? []).map((x: object) => ({ ...x, source: which }))];
    fit.method = [fit.method, `${src.member}: ${src.method}`].filter(Boolean).join(' / ');
    fit.reviewedAt = at;
    writeFileSync(FILES.fit, `${JSON.stringify(fit, null, 2)}\n`);
  } else throw new Error(`모르는 멤버 ${kind}`);
  console.log(`✓ ${kind} 검토 저장(설계 판 해시 기록)`);
}

function main() {
  const a = process.argv.slice(2);
  if (a[0] === '--import') return importMember(a[1], a[2], a[3] ?? new Date().toISOString().slice(0, 10));
  const problems = teamProblems();
  if (a[0] === '--stale') {
    const stale = problems.filter((x) => /옛 설계 판|검토 없음/.test(x));
    console.log(stale.length ? stale.join('\n') : '다시 검토할 항목 없음');
    return;
  }
  if (problems.length) {
    console.error(problems.map((x) => `✗ ${x}`).join('\n'));
    console.error(`\n${problems.length}건`);
    process.exit(1);
  }
  console.log('✓ 하네스 멤버 검토 — UI/UX·업무 절차·설계 적합성 모두 최신, 열린 blocker 0');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/ads-team.ts')) main();
