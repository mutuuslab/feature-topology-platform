import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from 'react';
import * as M from './data/model';
import { permMatrix, roles, policies as SEED_POL, policyStages as POL_STAGES, campaigns as SEED_CMP, incidents as SEED_INC, connectors as SEED_CONN, syncLogs as SEED_SYNC } from './data/refdata';
import { setDB, readiness, relationsOf, edgesOf } from './data/engine';
import { sameRevision, type RevisionRecord } from './data/revision';
import { BOM_BASELINES, type BomBaseline } from './data/featureBom';

// ── 상태 ──────────────────────────────────────────────
export interface CR { id: string; feature: string; type: string; status: string; owner: string; risk: string; }
export interface AuditEntry { ts: string; actor: string; action: string; target: string; detail: string; }
export interface ActState { enabled: boolean; rollout: number; killed: boolean }   // 차종(모델)별 활성화
export interface Experiment { id: string; feature: string; variant: string; metric: string; status: 'Draft' | 'Running' | 'Stopped'; uplift: number }
export interface Exception { id: string; feature: string; reason: string; approver: string; expiry: string; active: boolean }
// Phase A — 신규 화면 동작용 슬라이스
export interface ComplianceCheck { region: string; ruleId: string; feature: string; status: 'PASS' | 'BLOCK' | 'PENDING'; reason: string; ts: string }
export interface Scenario { id: string; name: string; total: number; pass: number; fail: number; status: 'idle' | 'running' | 'done'; step: number }
export interface PipelineState { stage: number; status: 'idle' | 'running' | 'done' | 'blocked'; logs: string[] }
export interface Subscription { feature: string; right: string; plan: string; qty: number; revenueWon: number }
export interface Vuln { id: string; severity: 'B' | 'W' | 'I'; feature: string; title: string; status: 'open' | 'ack' | 'patched' }
export interface SecurityState { signing: boolean; certs: { name: string; expiry: string }[]; vulns: Vuln[] }
export const PIPELINE_STAGES = ['Build', 'Verify', 'Package', 'Quality Gate', 'Staged Deploy', 'Release'];
// Phase B — 부분 화면 store화
export interface Policy { id: string; feature: string; stage: string; approver: string; rollout: number; version: number }
export interface Campaign { id: string; feature: string; type: string; cohort: string; rollout: number; status: string; step: number; auto: boolean }
export interface SupplierItem { feature: string; item: string; owner: 'OEM' | 'Supplier'; status: 'pending' | 'accepted' }
export interface Incident { id: string; feature: string; title: string; severity: string; status: string; cause: string; linkedCR: string }
export interface Connector { id: string; name: string; proto: string; dir: string; status: string; lastSync: string; enabled: boolean }
export interface SyncLog { ts: string; conn: string; event: string; status: string }
export const POLICY_STAGES = POL_STAGES as string[];
export const ROLLOUT_STEPS = [5, 20, 50, 100];

export const LIFECYCLE_ORDER: M.Lifecycle[] = ['Proposed', 'Approved', 'Developing', 'Verified', 'Released', 'Retired'];

// 전이 가드 — 단계별 구조 완전성 조건 (엑셀 FR-REG-002/005)
export function canTransition(f: M.Feature, to: M.Lifecycle): { ok: boolean; reason: string } {
  const rels = relationsOf(f.id);
  const has = (t: string) => rels.some(r => r.type === t);
  if (to === 'Approved' && !has('derives')) return { ok: false, reason: 'R01: 연결된 Requirement 없음' };
  if (to === 'Developing' && !has('controlled_by')) return { ok: false, reason: 'Feature 제어점(Flag) 미연결' };
  if (to === 'Verified' && !has('verified_by')) return { ok: false, reason: 'Test Evidence 미등록' };
  if (to === 'Released') { const r = readiness(f.id); if (r.decision !== 'RELEASE') return { ok: false, reason: `9-Gate 미통과 (${r.passCount}/9)` }; }
  return { ok: true, reason: '' };
}

export interface LiveData {
  tick: number;
  activation: number;      // 0..100 활성화 성공률(실시간)
  failRate: number;        // % 실패율
  rollback: number;
  p95: number;             // ms
  series: number[];        // 활성화율 시계열(최근 N)
  events: { type: string; detail: string; ts: string }[];
}

export interface AppState {
  features: M.Feature[];
  edges: M.Edge[];
  relations: M.Relation[];
  crs: CR[];
  revisions: RevisionRecord[];           // Feature 등록 Revision 레지스트리 (기준 C01 / UI02-S07 이력)
  bomBaselines: BomBaseline[];           // Feature BOM 기준선 레지스트리 (기준 C03 / UI04)
  runtime: Record<string, string>;        // featureId → runtime state
  audit: AuditEntry[];
  role: string;
  theme: 'light' | 'dark';
  lang: 'ko' | 'en';
  live: LiveData;
  activation: Record<string, ActState>;   // key `${featureId}@${model}`
  experiments: Experiment[];
  exceptions: Exception[];
  compliance: ComplianceCheck[];
  scenarios: Scenario[];
  pipeline: PipelineState;
  subscriptions: Subscription[];
  security: SecurityState;
  policies: Policy[];
  campaigns: Campaign[];
  incidents: Incident[];
  connectors: Connector[];
  syncLogs: SyncLog[];
  supplierAcceptance: SupplierItem[];
  homeWidgets: { id: string; on: boolean }[];
  navMode: 'function' | 'dept' | 'plane';
  toast?: { msg: string; kind: 'ok' | 'warn' | 'err' } | null;
}

const initialLive: LiveData = {
  tick: 0, activation: 98.7, failRate: 1.3, rollback: 3, p95: 42,
  series: [97, 98, 96, 99, 98.7, 95, 98, 99, 97, 98.7],
  events: [
    { type: 'POLICY_APPLY_SUCCESS', detail: 'VIN cohort pilot_kr_01', ts: '08:25' },
    { type: 'POLICY_APPLY_FAIL', detail: 'ECU version mismatch', ts: '08:24' },
  ],
};

const SEED_CRS: CR[] = [
  { id:'CR-2026-0142', feature:'FEAT-BDC-001', type:'Targeting Rule 변경', status:'Reviewed', owner:'박민준', risk:'Low' },
  { id:'CR-2026-0138', feature:'FEAT-CONN-001', type:'Variant 추가', status:'Analyzed', owner:'정하늘', risk:'Med' },
  { id:'CR-2026-0131', feature:'FEAT-ADAS-001', type:'SWC 변경', status:'Approved', owner:'이서연', risk:'High' },
];

const SEED_ACT: Record<string, ActState> = {
  'FEAT-BDC-001@IONIQ5': { enabled: true, rollout: 100, killed: false },
  'FEAT-BDC-001@GV80': { enabled: true, rollout: 60, killed: false },
  'FEAT-BDC-001@KONA': { enabled: false, rollout: 0, killed: false },
  'FEAT-ADAS-001@GV80': { enabled: true, rollout: 100, killed: false },
  'FEAT-CONN-001@IONIQ5': { enabled: true, rollout: 30, killed: false },
};
const SEED_EXP: Experiment[] = [
  { id: 'EXP-BDC-01', feature: 'FEAT-BDC-001', variant: 'A/B Targeting Rule', metric: '활성화율', status: 'Running', uplift: 3.2 },
  { id: 'EXP-LIGHT-02', feature: 'FEAT-LIGHT-001', variant: 'Welcome Light cohort 5%', metric: '만족도', status: 'Draft', uplift: 0 },
];
const SEED_EXC: Exception[] = [
  { id: 'EXC-2026-004', feature: 'FEAT-CONN-001', reason: '긴급 우회(현장 이슈)', approver: '정하늘', expiry: '2026-06-12', active: true },
];
const SEED_SUBS: Subscription[] = [
  { feature: 'FEAT-BDC-001', right: '구독', plan: 'Premium', qty: 142300, revenueWon: 142300 * 3900 },
  { feature: 'FEAT-ADAS-001', right: '옵션', plan: 'ADAS Pack', qty: 38200, revenueWon: 38200 * 12000 },
  { feature: 'FEAT-LIGHT-001', right: '무료', plan: 'Standard', qty: 0, revenueWon: 0 },
];
const SEED_SEC: SecurityState = {
  signing: true,
  certs: [
    { name: 'Policy Signing Cert', expiry: '2027-01-31' },
    { name: 'OTA TLS Cert', expiry: '2026-09-15' },
    { name: 'Device Attestation CA', expiry: '2028-03-01' },
  ],
  vulns: [
    { id: 'VUL-2026-014', severity: 'W', feature: 'FEAT-CONN-001', title: '의존 라이브러리 CVE-2026-xxxx (Medium)', status: 'open' },
  ],
};

export const initial: AppState = {
  features: M.features, edges: M.edges, relations: M.relations,
  crs: SEED_CRS, revisions: [], bomBaselines: BOM_BASELINES, runtime: { 'FEAT-BDC-001': 'enabled' }, audit: [],
  role: 'author', theme: 'light', lang: 'ko', live: initialLive,
  activation: SEED_ACT, experiments: SEED_EXP, exceptions: SEED_EXC,
  compliance: [], scenarios: [
    { id: 'SCN-KR-PREM', name: 'KR · Premium · Gen3', total: 48, pass: 0, fail: 0, status: 'idle', step: 0 },
    { id: 'SCN-EU-STD', name: 'EU · Standard · Gen2', total: 40, pass: 0, fail: 0, status: 'idle', step: 0 },
    { id: 'SCN-US-ADAS', name: 'US · ADAS Pack · Gen3', total: 40, pass: 0, fail: 0, status: 'idle', step: 0 },
  ], pipeline: { stage: -1, status: 'idle', logs: [] },
  subscriptions: SEED_SUBS, security: SEED_SEC,
  policies: SEED_POL.map(p => ({ ...p, version: 1 })),
  campaigns: SEED_CMP.map(c => ({ ...c, auto: false, step: ROLLOUT_STEPS.indexOf(c.rollout) >= 0 ? ROLLOUT_STEPS.indexOf(c.rollout) : (c.rollout >= 100 ? 3 : c.rollout >= 50 ? 2 : c.rollout >= 20 ? 1 : 0) })),
  incidents: SEED_INC.map(i => ({ id: i.id, feature: i.feature, title: i.title, severity: i.severity, status: i.status, cause: i.cause, linkedCR: i.linkedCR })),
  connectors: SEED_CONN.map(c => ({ ...c, enabled: c.status !== 'failed' })),
  syncLogs: SEED_SYNC.map(s => ({ ...s })),
  supplierAcceptance: [
    { feature: 'FEAT-BDC-001', item: 'API Contract 준수(OpenFeature)', owner: 'Supplier', status: 'accepted' },
    { feature: 'FEAT-BDC-001', item: 'Policy Apply 단위 검증(HIL)', owner: 'Supplier', status: 'pending' },
    { feature: 'FEAT-BDC-001', item: 'Rollback/Safe Default 보장', owner: 'OEM', status: 'accepted' },
    { feature: 'FEAT-BDC-001', item: '인수 테스트 증적 제출', owner: 'Supplier', status: 'pending' },
    { feature: 'FEAT-ADAS-001', item: 'ASIL-B 안전요구 추적', owner: 'Supplier', status: 'pending' },
  ],
  homeWidgets: [
    { id: 'KPI Tiles', on: true }, { id: 'My Work', on: true }, { id: 'Alerts', on: true },
    { id: 'Recent', on: false }, { id: 'Pinned Features', on: false }, { id: 'Telemetry', on: true },
  ],
  navMode: 'function',
  toast: null,
};

function clock() { try { return new Date().toTimeString().slice(0, 8); } catch { return '08:25:00'; } }
const EVK = [['POLICY_APPLY_SUCCESS', 'cohort pilot_kr_01'], ['POLICY_APPLY_FAIL', 'ECU version mismatch'], ['POLICY_ROLLBACK', 'previous stable policy'], ['TELEMETRY', 'fleet heartbeat']];

type Action =
  | { t: 'ADD_FEATURE'; f: M.Feature }
  | { t: 'ADD_EDGE'; e: M.Edge }
  | { t: 'CREATE_CR'; cr: CR }
  | { t: 'REVISION_SAVE'; r: RevisionRecord }
  | { t: 'BOM_SAVE'; b: BomBaseline }
  | { t: 'TOPOLOGY_REL_SAVE'; r: M.Relation; replaces?: string }
  | { t: 'KILL'; feature: string; actor: string }
  | { t: 'RECOVER'; feature: string }
  | { t: 'AUDIT'; entry: AuditEntry }
  | { t: 'ROLE'; role: string }
  | { t: 'THEME'; theme: 'light' | 'dark' }
  | { t: 'LANG'; lang: 'ko' | 'en' }
  | { t: 'TOAST'; toast: AppState['toast'] }
  | { t: 'SET_ACTIVATION'; key: string; patch: Partial<ActState>; actor?: string }
  | { t: 'SET_LIFECYCLE'; feature: string; to: M.Lifecycle; actor: string }
  | { t: 'SET_CR_STATUS'; id: string; status: string }
  | { t: 'ADD_EXPERIMENT'; exp: Experiment }
  | { t: 'EXP_STATUS'; id: string; status: 'Draft' | 'Running' | 'Stopped' }
  | { t: 'ADD_EXCEPTION'; exc: Exception }
  | { t: 'EXC_REVOKE'; id: string }
  | { t: 'RUN_COMPLIANCE' }
  | { t: 'RUN_SCENARIO'; id: string }
  | { t: 'RUN_PIPELINE' }
  | { t: 'PIPELINE_STEP' }
  | { t: 'ADD_SUBSCRIPTION'; sub: Subscription }
  | { t: 'ACK_VULN'; id: string; status: 'open' | 'ack' | 'patched' }
  | { t: 'PROMOTE_POLICY'; id: string; actor: string }
  | { t: 'CAMPAIGN_ADVANCE'; id: string }
  | { t: 'CAMPAIGN_AUTO'; id: string }
  | { t: 'INCIDENT_STATUS'; id: string; status: string }
  | { t: 'CONNECTOR_TOGGLE'; id: string }
  | { t: 'ACCEPT_SUPPLIER'; feature: string; item: string }
  | { t: 'ADD_POLICY'; policy: Policy }
  | { t: 'SET_HOME_WIDGETS'; widgets: { id: string; on: boolean }[] }
  | { t: 'SET_NAV_MODE'; mode: 'function' | 'dept' | 'plane' }
  | { t: 'LIVE_TICK' }
  | { t: 'RESET' };

// 파이프라인 단계 진행 (force=관리자 우회로 Quality Gate 통과)
function advancePipeline(s: AppState, force: boolean): AppState {
  const p = s.pipeline;
  if (p.status === 'done') return s;
  if (p.status === 'idle') return s;
  if (p.status === 'blocked' && !force) return s;
  const logs = [...p.logs];
  let stage = p.stage;
  // Quality Gate 가드: 9-Gate 미통과 시 차단 (force면 우회)
  if (PIPELINE_STAGES[stage] === 'Quality Gate' && !force) {
    const r = readiness('FEAT-BDC-001');
    if (r.decision !== 'RELEASE') return { ...s, pipeline: { stage, status: 'blocked', logs: [...logs, `⛔ Quality Gate 차단 — 9-Gate ${r.passCount}/9`] } };
  }
  if (p.status === 'blocked' && force) logs.push('✅ Quality Gate 관리자 승인 우회');
  stage += 1;
  if (stage >= PIPELINE_STAGES.length) return { ...s, pipeline: { stage: PIPELINE_STAGES.length - 1, status: 'done', logs: [...logs, '🎉 Release 완료 (SW배포≠Feature출시 분리)'] } };
  return { ...s, pipeline: { stage, status: 'running', logs: [...logs, `▶ ${PIPELINE_STAGES[stage]} 진행`] } };
}

export function reducer(s: AppState, a: Action): AppState {
  switch (a.t) {
    case 'ADD_FEATURE': return { ...s, features: [...s.features, a.f], toast: { msg: `${a.f.id} 등록됨`, kind: 'ok' } };
    case 'ADD_EDGE': return { ...s, edges: [...s.edges, a.e], toast: { msg: `엣지 추가: ${a.e.type}`, kind: 'ok' } };
    case 'CREATE_CR': return { ...s, crs: [a.cr, ...s.crs], toast: { msg: `${a.cr.id} 생성됨`, kind: 'ok' } };
    case 'REVISION_SAVE':
      return {
        ...s,
        revisions: s.revisions.some(r => sameRevision(r, a.r))
          ? s.revisions.map(r => (sameRevision(r, a.r) ? a.r : r))
          : [a.r, ...s.revisions],
        toast: { msg: `${a.r.id}@${a.r.version} · ${a.r.state} (rev ${a.r.recordRevision})`, kind: a.r.state === 'CHANGES_REQUESTED' ? 'warn' : 'ok' },
      };
    case 'BOM_SAVE': {
      const same = (x: BomBaseline) => x.id === a.b.id && x.version === a.b.version;
      return {
        ...s,
        bomBaselines: s.bomBaselines.some(same) ? s.bomBaselines.map(x => (same(x) ? a.b : x)) : [a.b, ...s.bomBaselines],
        toast: { msg: `기준선 ${a.b.id}@${a.b.version} · ${a.b.state} (hash ${a.b.contentHash.slice(0, 12)}…)`, kind: a.b.state === 'REVOKED' || a.b.state === 'CHANGES_REQUESTED' ? 'warn' : 'ok' },
      };
    }
    case 'TOPOLOGY_REL_SAVE': {
      const next = a.replaces
        ? s.relations.map(x => (x.id === a.replaces ? a.r : x))
        : (s.relations.some(x => x.id === a.r.id) ? s.relations.map(x => (x.id === a.r.id ? a.r : x)) : [...s.relations, a.r]);
      return {
        ...s,
        relations: next,
        audit: [{ ts: nowish(), actor: s.role, action: 'TOPOLOGY_REL_SAVE', target: `${a.r.source} → ${a.r.target}`, detail: a.r.type }, ...s.audit],
        toast: { msg: `관계 ${a.r.type} 저장 — ${a.r.source} → ${a.r.target}`, kind: 'ok' },
      };
    }
    case 'KILL': return { ...s, runtime: { ...s.runtime, [a.feature]: 'disabled' },
      audit: [{ ts: nowish(), actor: a.actor, action: 'KILL', target: a.feature, detail: 'Safe Default=disabled' }, ...s.audit],
      toast: { msg: `${a.feature} Kill 실행 → Safe Default`, kind: 'warn' } };
    case 'RECOVER': return { ...s, runtime: { ...s.runtime, [a.feature]: 'enabled' } };
    case 'AUDIT': return { ...s, audit: [a.entry, ...s.audit] };
    case 'ROLE': return { ...s, role: a.role };
    case 'THEME': return { ...s, theme: a.theme };
    case 'LANG': return { ...s, lang: a.lang };
    case 'TOAST': return { ...s, toast: a.toast };
    case 'SET_ACTIVATION': {
      const cur = s.activation[a.key] || { enabled: false, rollout: 0, killed: false };
      const next = { ...cur, ...a.patch };
      const [fid, model] = a.key.split('@');
      return { ...s, activation: { ...s.activation, [a.key]: next },
        audit: [{ ts: nowish(), actor: a.actor || s.role, action: 'ACTIVATION', target: fid, detail: `${model}: ${next.killed ? 'KILLED' : next.enabled ? `ON ${next.rollout}%` : 'OFF'}` }, ...s.audit],
        toast: { msg: `${fid} · ${model} → ${next.killed ? 'Kill' : next.enabled ? `활성 ${next.rollout}%` : '비활성'}`, kind: next.killed ? 'warn' : 'ok' } };
    }
    case 'SET_LIFECYCLE':
      return { ...s, features: s.features.map(f => f.id === a.feature ? { ...f, lifecycle: a.to } : f),
        audit: [{ ts: nowish(), actor: a.actor, action: 'LIFECYCLE', target: a.feature, detail: `→ ${a.to}` }, ...s.audit],
        toast: { msg: `${a.feature} → ${a.to}`, kind: 'ok' } };
    case 'SET_CR_STATUS':
      return { ...s, crs: s.crs.map(c => c.id === a.id ? { ...c, status: a.status } : c), toast: { msg: `${a.id} → ${a.status}`, kind: 'ok' } };
    case 'ADD_EXPERIMENT': return { ...s, experiments: [a.exp, ...s.experiments], toast: { msg: `${a.exp.id} 실험 생성`, kind: 'ok' } };
    case 'EXP_STATUS': return { ...s, experiments: s.experiments.map(e => e.id === a.id ? { ...e, status: a.status } : e), toast: { msg: `실험 ${a.id} → ${a.status}`, kind: 'ok' } };
    case 'ADD_EXCEPTION': return { ...s, exceptions: [a.exc, ...s.exceptions], toast: { msg: `${a.exc.id} 예외정책 승인`, kind: 'ok' } };
    case 'EXC_REVOKE': return { ...s, exceptions: s.exceptions.map(e => e.id === a.id ? { ...e, active: false } : e), toast: { msg: `${a.id} 해제`, kind: 'warn' } };
    case 'RUN_COMPLIANCE': {
      const regions = ['KR', 'EU', 'US', 'CN'];
      const ts = nowish();
      const out: ComplianceCheck[] = [];
      s.features.slice(0, 4).forEach(f => regions.forEach(region => {
        let status: ComplianceCheck['status'] = 'PASS'; let reason = '법규·개인정보 요건 충족';
        if (region === 'US' && f.deployType !== 'Policy-only') { status = 'BLOCK'; reason = 'US 미인증 구성 — Variant Blocked'; }
        else if (region === 'EU' && (f.safety || '').startsWith('ASIL')) { status = 'PENDING'; reason = 'UNECE R156 추가 심사 필요'; }
        else if (region === 'CN') { status = 'PENDING'; reason = '현지 데이터 규정(PIPL) 검토 중'; }
        else if (region === 'EU') reason = 'GDPR · UNECE R156 충족';
        out.push({ region, ruleId: `${region}-REG`, feature: f.id, status, reason, ts });
      }));
      return { ...s, compliance: out, audit: [{ ts, actor: s.role, action: 'COMPLIANCE_RUN', target: '-', detail: `${out.length}건 검증` }, ...s.audit], toast: { msg: '컴플라이언스 검증 완료', kind: 'ok' } };
    }
    case 'RUN_SCENARIO':
      return { ...s, scenarios: s.scenarios.map(sc => sc.id === a.id ? { ...sc, status: 'running', step: 0, pass: 0, fail: 0 } : sc), toast: { msg: `${a.id} 시나리오 실행`, kind: 'ok' } };
    case 'RUN_PIPELINE': return { ...s, pipeline: { stage: 0, status: 'running', logs: [`▶ ${PIPELINE_STAGES[0]} 시작`] } };
    case 'PIPELINE_STEP': return advancePipeline(s, true);
    case 'ADD_SUBSCRIPTION': return { ...s, subscriptions: [a.sub, ...s.subscriptions], toast: { msg: `${a.sub.feature} 구독 추가`, kind: 'ok' } };
    case 'ACK_VULN': return { ...s, security: { ...s.security, vulns: s.security.vulns.map(v => v.id === a.id ? { ...v, status: a.status } : v) }, toast: { msg: `${a.id} → ${a.status}`, kind: a.status === 'patched' ? 'ok' : 'warn' } };
    case 'PROMOTE_POLICY': {
      const cur = s.policies.find(p => p.id === a.id); if (!cur) return s;
      const i = POLICY_STAGES.indexOf(cur.stage);
      if (i >= POLICY_STAGES.length - 1) return { ...s, toast: { msg: '이미 최종 단계(Monitored)', kind: 'warn' } };
      const to = POLICY_STAGES[i + 1];
      const rollout = to === 'Deployed' || to === 'Monitored' ? 100 : cur.rollout;
      return { ...s, policies: s.policies.map(p => p.id === a.id ? { ...p, stage: to, rollout, version: cur.version + (to === 'Deployed' ? 1 : 0) } : p),
        audit: [{ ts: nowish(), actor: a.actor, action: 'POLICY_PROMOTE', target: a.id, detail: `${cur.stage} → ${to}` }, ...s.audit],
        toast: { msg: `${a.id} → ${to}`, kind: 'ok' } };
    }
    case 'CAMPAIGN_ADVANCE': {
      const cur = s.campaigns.find(c => c.id === a.id); if (!cur) return s;
      if (cur.step >= ROLLOUT_STEPS.length - 1) return { ...s, campaigns: s.campaigns.map(c => c.id === a.id ? { ...c, status: 'monitored' } : c), toast: { msg: `${a.id} 100% 완료 → monitored`, kind: 'ok' } };
      // telemetry 가드: 실패율 임계 초과 시 단계 진행 차단
      if (s.live.failRate > 5) return { ...s, toast: { msg: `Telemetry 가드: 실패율 ${s.live.failRate}% > 5% — 단계 진행 차단`, kind: 'warn' } };
      const step = cur.step + 1; const rollout = ROLLOUT_STEPS[step];
      return { ...s, campaigns: s.campaigns.map(c => c.id === a.id ? { ...c, step, rollout, status: rollout >= 100 ? 'monitored' : 'rolling' } : c),
        audit: [{ ts: nowish(), actor: s.role, action: 'CAMPAIGN_ADVANCE', target: a.id, detail: `rollout ${rollout}%` }, ...s.audit],
        toast: { msg: `${a.id} → ${rollout}% (telemetry guard 통과)`, kind: 'ok' } };
    }
    case 'INCIDENT_STATUS': return { ...s, incidents: s.incidents.map(i => i.id === a.id ? { ...i, status: a.status } : i),
      audit: [{ ts: nowish(), actor: s.role, action: 'INCIDENT', target: a.id, detail: `→ ${a.status}` }, ...s.audit],
      toast: { msg: `${a.id} → ${a.status}`, kind: a.status === 'resolved' ? 'ok' : 'warn' } };
    case 'CONNECTOR_TOGGLE': return { ...s, connectors: s.connectors.map(c => c.id === a.id ? { ...c, enabled: !c.enabled, status: !c.enabled ? 'connected' : 'disabled' } : c),
      toast: { msg: `${a.id} ${s.connectors.find(c => c.id === a.id)?.enabled ? '중지' : '연결'}`, kind: 'ok' } };
    case 'CAMPAIGN_AUTO': return { ...s, campaigns: s.campaigns.map(c => c.id === a.id ? { ...c, auto: !c.auto } : c),
      toast: { msg: `${a.id} 자동 배포 ${s.campaigns.find(c => c.id === a.id)?.auto ? 'OFF' : 'ON'}`, kind: 'ok' } };
    case 'ACCEPT_SUPPLIER': return { ...s, supplierAcceptance: s.supplierAcceptance.map(x => x.feature === a.feature && x.item === a.item ? { ...x, status: 'accepted' } : x),
      audit: [{ ts: nowish(), actor: s.role, action: 'SUPPLIER_ACCEPT', target: a.feature, detail: a.item }, ...s.audit],
      toast: { msg: '인수 기준 승인', kind: 'ok' } };
    case 'ADD_POLICY': return { ...s, policies: [a.policy, ...s.policies],
      audit: [{ ts: nowish(), actor: s.role, action: 'POLICY_CREATE', target: a.policy.id, detail: `${a.policy.feature} · ${a.policy.stage}` }, ...s.audit],
      toast: { msg: `${a.policy.id} 정책 등록 (Draft)`, kind: 'ok' } };
    case 'SET_HOME_WIDGETS': return { ...s, homeWidgets: a.widgets, toast: { msg: '홈 레이아웃 저장됨', kind: 'ok' } };
    case 'SET_NAV_MODE': return { ...s, navMode: a.mode };
    case 'LIVE_TICK': {
      const t = s.live.tick + 1;
      const activation = Math.max(90, Math.min(99.9, s.live.activation + (Math.random() - 0.5) * 1.4));
      const series = [...s.live.series.slice(1), Number(activation.toFixed(1))];
      const p95 = Math.max(28, Math.min(95, s.live.p95 + (Math.random() - 0.5) * 6));
      let events = s.live.events;
      let rollback = s.live.rollback;
      if (t % 2 === 0) {
        const k = EVK[t % EVK.length];
        if (k[0] === 'POLICY_ROLLBACK') rollback += 1;
        events = [{ type: k[0], detail: k[1], ts: clock() }, ...s.live.events].slice(0, 8);
      }
      // 시나리오 진행(5스텝 → 완료, ~5% 실패), 파이프라인 자동 진행, 구독 사용량 증가, 실험 uplift 미세 변동
      let scenarios = s.scenarios;
      if (scenarios.some(sc => sc.status === 'running')) {
        scenarios = scenarios.map(sc => {
          if (sc.status !== 'running') return sc;
          const step = sc.step + 1;
          if (step >= 5) { const fail = Math.round(sc.total * 0.05); return { ...sc, step: 5, status: 'done' as const, fail, pass: sc.total - fail }; }
          return { ...sc, step };
        });
      }
      const pipeline = s.pipeline.status === 'running' ? advancePipeline(s, false).pipeline : s.pipeline;
      const subscriptions = s.subscriptions.map(su => su.qty > 0 ? { ...su, qty: su.qty + Math.round(su.qty * 0.0004), revenueWon: Math.round(su.revenueWon * 1.0004) } : su);
      // 연결된 커넥터에서 주기적으로 sync 로그 유입(동기화 시뮬)
      let syncLogs = s.syncLogs;
      if (t % 3 === 0) {
        const on = s.connectors.filter(c => c.enabled);
        if (on.length) { const c = on[t % on.length]; syncLogs = [{ ts: clock().slice(0, 5), conn: c.id, event: `${c.name} 동기화 x${40 + (t % 60)}건`, status: t % 9 === 0 ? 'retry' : 'ok' }, ...s.syncLogs].slice(0, 12); }
      }
      // 단계적 배포 자동화(FR-PDA): auto 캠페인은 실패율 가드로 자동 승급/롤백
      const failRate = Number((100 - activation).toFixed(1));
      let campaigns = s.campaigns;
      if (t % 3 === 0 && s.campaigns.some(c => c.auto && c.rollout < 100)) {
        campaigns = s.campaigns.map(c => {
          if (!c.auto || c.rollout >= 100) return c;
          if (failRate <= 5 && c.step < ROLLOUT_STEPS.length - 1) { const step = c.step + 1; return { ...c, step, rollout: ROLLOUT_STEPS[step], status: ROLLOUT_STEPS[step] >= 100 ? 'monitored' : 'rolling' }; }
          if (failRate > 8 && c.step > 0) { const step = c.step - 1; return { ...c, step, rollout: ROLLOUT_STEPS[step], status: 'rolling' }; }  // 메트릭 기반 자동 롤백
          return c;
        });
      }
      return { ...s, scenarios, pipeline, subscriptions, syncLogs, campaigns,
        live: { tick: t, activation: Number(activation.toFixed(1)), failRate, rollback, p95: Math.round(p95), series, events } };
    }
    case 'RESET': { localStorage.removeItem('fp.state.v2'); return { ...initial }; }
    default: return s;
  }
}

// new Date()는 환경 제약과 무관 — 브라우저에서만 실행되므로 사용 가능
function nowish() { try { return new Date().toISOString().slice(0, 16).replace('T', ' '); } catch { return '2026-06-05 08:30'; } }

function load(): AppState {
  try {
    const raw = localStorage.getItem('fp.state.v2');
    if (raw) {
      const p = JSON.parse(raw);
      // 저장된 역할이 기준 9역할 키가 아니면(구버전 라벨) 최소 역할로 정규화한다 —
      // 권한 게이트는 permMatrix[역할키] 로만 판정하므로 라벨이 남으면 전 동작이 차단된다.
      const role = roles.includes(p?.role) ? p.role : initial.role;
      return { ...initial, ...p, role, toast: null };
    }
  } catch {}
  return initial;
}

interface Ctx { state: AppState; dispatch: Dispatch<Action>; can: (verb: string) => boolean; }
/** 액션·권한만 노출하는 컨텍스트 — 2초 LIVE_TICK 마다 값이 바뀌지 않는다. */
interface ApiCtx { dispatch: Dispatch<Action>; can: (verb: string) => boolean; }
/** 화면 전체가 참조하는 '안정 슬라이스'. 실시간 데이터(live/scenarios/…)는 의도적으로 제외한다. */
interface ShellCtx { role: string; navMode: 'function' | 'dept' | 'plane'; lang: string; theme: string; }

const AppCtx = createContext<Ctx>(null as any);
const AppApiCtx = createContext<ApiCtx>({ dispatch: () => {}, can: () => false });
const AppShellCtx = createContext<ShellCtx>({
  role: initial.role,
  navMode: (initial.navMode || 'function') as 'function' | 'dept' | 'plane',
  lang: initial.lang,
  theme: initial.theme,
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  // 엔진 DB 동기화 + 영속 + 테마/언어 DOM 반영 (live·toast 제외 영속)
  useEffect(() => {
    setDB({ features: state.features, edges: state.edges, relations: state.relations });
    const { toast, live, ...persist } = state;
    try { localStorage.setItem('fp.state.v2', JSON.stringify(persist)); } catch {}
    document.documentElement.setAttribute('data-theme', state.theme);
    document.documentElement.lang = state.lang;
  }, [state.features, state.edges, state.relations, state.crs, state.revisions, state.bomBaselines, state.runtime, state.audit, state.role, state.theme, state.lang, state.activation, state.experiments, state.exceptions, state.compliance, state.security, state.policies, state.campaigns, state.incidents, state.connectors, state.supplierAcceptance, state.homeWidgets, state.navMode]);

  // 실시간 시뮬레이션 틱 (2초)
  useEffect(() => {
    const id = setInterval(() => dispatch({ t: 'LIVE_TICK' }), 2000);
    return () => clearInterval(id);
  }, []);

  const can = useCallback((verb: string) => (permMatrix[state.role] || []).includes(verb), [state.role]);
  const api = useMemo<ApiCtx>(() => ({ dispatch, can }), [can]);
  const shell = useMemo<ShellCtx>(
    () => ({ role: state.role, navMode: (state.navMode || 'function') as 'function' | 'dept' | 'plane', lang: state.lang, theme: state.theme }),
    [state.role, state.navMode, state.lang, state.theme],
  );
  return (
    <AppApiCtx.Provider value={api}>
      <AppShellCtx.Provider value={shell}>
        <AppCtx.Provider value={{ state, dispatch, can }}>{children}</AppCtx.Provider>
      </AppShellCtx.Provider>
    </AppApiCtx.Provider>
  );
}

export const useApp = () => useContext(AppCtx);

/** 액션·권한 전용 — 실시간 틱과 분리된 구독(2초마다 리렌더되지 않는다). */
export const useAppApi = () => useContext(AppApiCtx);

/** 언어·테마·역할·네비 모드 전용 — 실시간 슬라이스와 분리된 구독. */
export const useAppShell = () => useContext(AppShellCtx);

// 간편 토스트 — 비동작 버튼에 피드백 부여
export const useToast = () => {
  const { dispatch } = useAppApi();
  return (msg: string, kind: 'ok' | 'warn' | 'err' = 'ok') => dispatch({ t: 'TOAST', toast: { msg, kind } });
};

// 역할별 기본 착지 화면 — 그 역할이 실제로 쓰는 구현 화면 (data/uiLinks.ROLE_HOME_IMPL).
// 역할별 기본 착지 화면은 구현 화면 경로만 쓴다 (data/uiLinks.ROLE_HOME_IMPL).
export { ROLE_HOME_IMPL as roleHome } from './data/uiLinks';
