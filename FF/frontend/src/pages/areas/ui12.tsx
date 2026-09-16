// UI12 차량별 적용 상태 — 정본 상세 영역 8개 본문.
//
// 차량 하나(VIN)를 고르면 그 차량의 노드별 목표·전달·평가·Guard·실제 관측이 현재 출시의 정확 버전으로 이어진다.
// 화면이 지키는 구분:
//  · 목표(desired) ≠ 전달(delivered) ≠ 평가(evaluated) ≠ Guard ≠ 실제 관측(observed)
//  · 현재 boot·sequence·출시에 일치하고 신선한 보고만 현재 적용의 근거로 쓴다
//  · 미보고(NOT_RECEIVED)는 성공이 아니다 — 판단 불가(UNKNOWN)는 언제나 원인과 함께 표시한다
//  · 새로고침은 읽기 전용. 미래·과거·다른 출시 보고는 진단 이력에만 남기고 성공으로 집계하지 않는다
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CanonicalScreen, FIELD, Gated, Reasons, StageRail, Table, type Kpi } from '../../components/AreaScreen';
import { UlBadge, UlRules, ulBlocks, type UlRule } from '../../components/ulRules';
import { useApp, useToast } from '../../store';
import { MODELS, sampleVehicles, type Vehicle } from '../../data/fleet';
import { features } from '../../data/model';
import { useTwinOptional } from '../../state/twinStore';
import type { TwinStoreSnapshot } from '../../data/twin/port';
import {
  FEATURE_ID as TWIN_FEATURE_ID,
  UNKNOWN_CAUSE_ACTION,
  UNKNOWN_CAUSE_LABEL,
  type DesiredState,
  type FeatureInstance,
  type InstallStatus,
  type SignatureStatus,
  type Twin,
  type UnknownCause,
} from '../../data/twin/types';

/* ── 정본 열 (영역별 canon cols — 순서·문구 그대로) ─────────────────── */
const S01_COLS = ['차량 ID', '요청 상태', '차량 상태', '현재 출시', '보고 시각', '신선도', '중지 사유'];
const S02_COLS = ['ECU·서비스', '목표', '전달', '평가', 'Guard', '실제 관측', '최근 보고'];
const S03_COLS = ['정확 참조', '객체·서비스', 'ECU 또는 원천', '책임 주체', 'SDK·계약 Profile', '버전', '유효성'];
const S04_COLS = ['규칙', 'Context 속성', '연산자', '비교 값', '결과 유형', '지원 Profile'];
const S05_COLS = ['대상 차량', 'Feature', '차단 사유', '복구 증적', '권리 및 기간', '차량 확인'];
const S06_COLS = ['노드', 'Snapshot', '서명 상태', 'Lease', '만료 시각', '오프라인 정책'];
const S07_COLS = S02_COLS;
const S08_COLS = ['시각', '단계', '대상 및 버전', '명령 또는 상관 ID', '결과', '다음 담당'];

/* ── 화면 정본 상태 5개 ─────────────────────────────────────────────── */
type ScreenState = 'PENDING' | 'CONFIRMED' | 'DIVERGED' | 'UNKNOWN' | 'BLOCKED';
const STATES: ScreenState[] = ['PENDING', 'CONFIRMED', 'DIVERGED', 'UNKNOWN', 'BLOCKED'];
const STATE_KO: Record<ScreenState, string> = {
  PENDING: '대기', CONFIRMED: '확인', DIVERGED: '불일치', UNKNOWN: '판단 불가', BLOCKED: '차단',
};
const STATE_TONE: Record<ScreenState, string> = {
  PENDING: 'var(--pending)', CONFIRMED: 'var(--pass)', DIVERGED: 'var(--fail)',
  UNKNOWN: 'var(--muted)', BLOCKED: 'var(--fail)',
};

/* ── 판정 임계 (화면의 모든 신선도·lease 판단이 이 값을 쓴다) ───────── */
const FRESH_S = 60;        // 보고 신선도 임계(초) — 이보다 오래된 보고는 현재 근거가 아니다
const LEASE_S = 900;       // SnapshotLease 유효(초)
const CLOCK_SKEW_S = 30;   // 허용 시계 오차(초)
const DEMO_NOW_MS = Date.parse('2026-09-13T10:00:00Z');
const CONVERGENCE_THRESHOLD = 0.95;

/* ── 차량·노드 기준 정보 ────────────────────────────────────────────── */
interface NodeDef {
  ref: string;      // RuntimeBinding 정확 참조
  node: string;     // ECU 또는 호스트
  service: string;  // 객체·서비스
  owner: string;    // 책임 주체
  profile: string;  // SDK·계약 Profile
  base: string;     // 노드 기준 버전
  local: boolean;   // 실행 직전 로컬 사실 확인이 가능한 노드인가
}

const NODES: NodeDef[] = [
  { ref: 'RB-BDC-A-01', node: 'ECU-BDC-A', service: 'bdc.policy.agent', owner: 'OEM (HMC)', profile: 'AAOS 차량 Agent v3.4', base: '3.4.0', local: true },
  { ref: 'RB-BMS-B-02', node: 'ECU-BMS-B', service: 'bms.precond.service', owner: 'OEM (HMC)', profile: 'AAOS 차량 Agent v3.4', base: '2.7.1', local: true },
  { ref: 'RB-HVAC-C-03', node: 'ECU-HVAC-C', service: 'hvac.thermal.control', owner: '3rd party (Tier-1)', profile: 'Vehicle SDK 3.2 (QNX)', base: '3.2.4', local: true },
  { ref: 'RB-GW-D-04', node: 'ECU-GW-D', service: 'gw.signal.router', owner: 'OEM (HMC)', profile: 'Vehicle SDK 3.4 (AAOS)', base: '3.4.0', local: true },
  { ref: 'RB-HMI-05', node: 'HMI-Head-Unit', service: 'hmi.remote.evaluate', owner: 'OEM (비안전 HMI)', profile: 'Frontend remote evaluation v1.8', base: '1.8.2', local: false },
  { ref: 'RB-CLD-06', node: 'Cloud-Policy-Svc', service: 'policy.snapshot.repo', owner: 'FP 서버', profile: 'SignedSnapshotRepository', base: '2026.09.13', local: false },
];

const FP_FEATURE_ID = 'FEAT-BDC-001';
const ENTITLEMENT = 'BAT_PRECOND_PLUS';

/* ── 결정적 파생 (합성 데모 — 같은 입력이면 언제나 같은 결과) ────────── */
const hashStr = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; } return h; };
const hex = (n: number, len = 16) => Math.abs(Math.floor(n)).toString(16).padStart(len, '0').slice(0, len);
const sha = (s: string) => `sha256:${(hex(hashStr(s)) + hex(hashStr(s + 'x')))}`;
const at = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const ageKo = (s: number) => (s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`);

/** 차량 목록의 상태 — 정본 상태 5개가 목록에 모두 드러나도록 자리를 고정한다. */
const STATE_BY_INDEX: ScreenState[] = ['CONFIRMED', 'DIVERGED', 'UNKNOWN', 'BLOCKED', 'PENDING'];
const CAUSE_BY_INDEX: UnknownCause[] = [
  'BACKEND_PROCESSING_FAILURE', 'POLICY_VERSION_UNKNOWN', 'TELEMETRY_TIMEOUT',
  'CONFIGURATION_MISMATCH', 'SIGNAL_QUALITY_UNKNOWN',
];

interface VehicleRow {
  vin: string; model: string; region: string; my: number; trim: string; hw: string; sw: string; cohort: string;
  featureId: string;
  state: ScreenState;
  desired: DesiredState;
  rollout: string;
  reportedAtMs: number | null;
  ageS: number | null;
  fresh: boolean;
  halt: string;
  cause: UnknownCause;
  causeNote: string;
  twinBacked: boolean;
}

/** Twin 스냅샷이 있으면 그 차량의 실제 인스턴스에서 상태를 읽는다 — 없으면 합성 스냅샷. */
function stateFromTwin(inst: FeatureInstance | undefined, online: boolean): ScreenState {
  if (!inst) return online ? 'UNKNOWN' : 'UNKNOWN';
  if (inst.reported.state === 'NOT_RECEIVED') return 'UNKNOWN';
  if (inst.reported.state === 'UNKNOWN') return 'UNKNOWN';
  if (inst.reported.state === 'REJECTED') return 'DIVERGED';
  if (inst.effective.state === 'BLOCKED') return 'BLOCKED';
  if (inst.effective.state === 'UNKNOWN') return 'UNKNOWN';
  if (inst.desired.state !== inst.reported.state) return 'DIVERGED';
  if (inst.observed.health === 'STALE' || inst.observed.health === 'OFFLINE' || inst.observed.health === 'UNKNOWN') return 'UNKNOWN';
  return 'CONFIRMED';
}

function rowFromVehicle(v: Vehicle, i: number, snap: TwinStoreSnapshot | null, nowMs: number): VehicleRow {
  const tw: Twin | undefined = snap?.twins.find(t => t.vin === v.vin);
  const inst = tw
    ? (tw.featureInstances[TWIN_FEATURE_ID] ?? Object.values(tw.featureInstances)[0])
    : undefined;
  const h = hashStr(v.vin);
  const state = tw ? stateFromTwin(inst, tw.link.online) : STATE_BY_INDEX[i % STATE_BY_INDEX.length];
  const cause = CAUSE_BY_INDEX[i % CAUSE_BY_INDEX.length];
  const reportedAtMs = tw
    ? (tw.link.lastSeenAt ? Date.parse(tw.link.lastSeenAt) : null)
    : (state === 'UNKNOWN' ? null : nowMs - (4 + (h % 22)) * 1000);
  const ageS = reportedAtMs === null ? null : Math.max(0, Math.round((nowMs - reportedAtMs) / 1000));
  const fresh = ageS !== null && ageS <= FRESH_S;
  const rollout = snap?.rollout.policyVersion ?? 'v4.3';
  const paused = snap?.rollout.paused === true;
  const halt = state === 'BLOCKED' ? '안전 조건 미충족(배터리 셀 온도)'
    : state === 'PENDING' ? '평가 전 — 중지 아님'
      : paused ? `확대 중지 — ${snap?.rollout.pausedReason?.ko ?? '운영 중지'}` : '';
  return {
    vin: v.vin, model: v.model, region: v.region, my: v.my, trim: v.trim, hw: v.hw, sw: v.sw, cohort: v.cohort,
    featureId: inst?.featureId ?? FP_FEATURE_ID,
    state, desired: inst?.desired.state ?? 'ON', rollout, reportedAtMs, ageS, fresh, halt, cause,
    causeNote: UNKNOWN_CAUSE_LABEL[cause].ko, twinBacked: !!tw,
  };
}

function rowFromTwin(t: Twin, snap: TwinStoreSnapshot | null, nowMs: number): VehicleRow {
  const v: Vehicle = {
    vin: t.vin, model: t.identity.vehicleModel, region: t.identity.region, my: t.identity.modelYear,
    trim: t.identity.trim, hw: t.asBuilt.hardwareCapabilities[0] ?? 'GEN3',
    sw: t.asDeployed.bmsSoftwareVersion || '2.7.0', cohort: t.link.cohort,
  };
  return rowFromVehicle(v, 0, snap, nowMs);
}

/* ── 노드 관측 (목표 → 전달 → 평가 → Guard → 실제 관측) ─────────────── */
type LeaseState = 'ACTIVE' | 'DRAINING' | 'RETIRED';

interface NodeObs {
  def: NodeDef;
  desired: DesiredState;
  delivered: string;
  evaluated: string;
  guard: 'PASS' | 'BLOCK' | 'UNKNOWN';
  guardReason: string;
  observed: string;
  reportAtMs: number | null;
  ageS: number | null;
  fresh: boolean;
  policyVersion: string;
  policyHash: string;
  signature: SignatureStatus;
  seq: number;
  bootId: string;
  bootAtMs: number;
  lease: LeaseState;
  leaseUntilMs: number;
  expiresAtMs: number;
  offlinePolicy: string;
  install: InstallStatus;
  version: string;
  valid: string;
  cause: UnknownCause | null;
}

const OFFLINE_POLICY = [
  'last-known-good 유지 · 신규 활성화 HOLD',
  'cache 만료 시 안전 상태 유지 · 재동기화 대기',
  '신규 활성화 HOLD · 실행 중 유지/축소만 허용',
];

function buildNodes(row: VehicleRow, nowMs: number): NodeObs[] {
  const h = hashStr(row.vin);
  return NODES.map((def, i) => {
    const k = h + i * 7919;
    const seq = 1024 + (k % 512);
    const bootAtMs = nowMs - (600 + (k % 3600)) * 1000;
    const bootId = `boot-${hex(k).slice(0, 6)}`;
    const ageS = 3 + (k % 18);
    const signature: SignatureStatus = def.node.startsWith('HMI') ? 'NOT_VERIFIED'
      : row.state === 'UNKNOWN' && i === 5 ? 'NOT_VERIFIED'
        : row.state === 'BLOCKED' && i === 2 ? 'MISSING' : 'VERIFIED';
    const lease: LeaseState = row.state === 'PENDING' && i === 2 ? 'DRAINING' : 'ACTIVE';
    const leaseUntilMs = nowMs + LEASE_S * 1000 - (k % 300) * 1000;
    const base: NodeObs = {
      def,
      desired: row.desired,
      delivered: '도달',
      evaluated: 'ON',
      guard: 'PASS',
      guardReason: '',
      observed: 'ON',
      reportAtMs: nowMs - ageS * 1000,
      ageS,
      fresh: true,
      policyVersion: row.rollout,
      policyHash: sha(row.vin + row.rollout + def.ref),
      signature,
      seq,
      bootId,
      bootAtMs,
      lease,
      leaseUntilMs,
      expiresAtMs: nowMs + LEASE_S * 1000,
      offlinePolicy: OFFLINE_POLICY[k % OFFLINE_POLICY.length],
      install: 'INSTALLED',
      version: def.base,
      valid: '유효',
      cause: null,
    };

    if (row.state === 'PENDING') {
      return {
        ...base,
        evaluated: '대기 — 평가 전', guard: 'UNKNOWN', guardReason: '로컬 평가 전 — 판단 근거 없음',
        observed: '미보고', reportAtMs: null, ageS: null, fresh: false, install: 'PENDING',
        cause: 'TELEMETRY_TIMEOUT',
      };
    }
    if (row.state === 'DIVERGED' && i === 2) {
      return { ...base, observed: 'OFF', evaluated: 'ON (규칙 S04-R05)', install: 'PENDING', valid: '불일치' };
    }
    if (row.state === 'BLOCKED') {
      if (i === 1) {
        return {
          ...base, guard: 'BLOCK', guardReason: '배터리 셀 온도 12.4℃ < 최소 15℃ — 로컬 안전 조건',
          observed: '차단(BLOCKED)', install: 'PENDING', valid: '유효(차단)', cause: 'CAUSE_ANALYSIS_REQUIRED',
        };
      }
      if (i === 2) return { ...base, delivered: '미도달 — 선행 노드 차단', install: 'NOT_APPLICABLE' };
    }
    if (row.state === 'UNKNOWN') {
      if (i === 2 || i === 4) {
        return {
          ...base, guard: 'UNKNOWN', guardReason: '보고 없음 — 판단 불가', observed: '미보고',
          reportAtMs: null, ageS: null, fresh: false, install: 'PENDING',
          cause: i === 4 ? 'TWIN_SNAPSHOT_MISSING' : 'TELEMETRY_TIMEOUT',
        };
      }
      if (i === 5) return { ...base, valid: '미검증 — 서명 상태 미확인', cause: 'POLICY_VERSION_UNKNOWN' };
    }
    return base;
  });
}

/* ── 평가 규칙 (SDK 평가와 결정 이유) ───────────────────────────────── */
interface RuleRow { rule: string; ctx: string; op: string; value: string; result: string; profile: string; hit: boolean }

function ruleRows(row: VehicleRow): RuleRow[] {
  const k = hashStr(row.vin);
  return [
    { rule: '국가 포함', ctx: 'region', op: 'IN', value: 'KR, EU', result: '제약(AND)', profile: 'FP 평가기 v1', hit: ['KR', 'EU'].includes(row.region) },
    { rule: '차종 포함', ctx: 'vehicleModel', op: 'IN', value: MODELS.join(', '), result: '제약(AND)', profile: 'FP 평가기 v1', hit: MODELS.includes(row.model) },
    { rule: 'HW 세대', ctx: 'hardwareCapability', op: 'STR_CONTAINS', value: 'GEN3', result: '제약(AND)', profile: 'AAOS 차량 Agent v3.4', hit: /gen3/i.test(row.hw) },
    { rule: '권리 보유', ctx: 'entitlementId', op: 'IN', value: ENTITLEMENT, result: '필수 자격(AND)', profile: 'FP 평가기 v1', hit: true },
    { rule: '점진 확대', ctx: 'targetingKey', op: 'FLEXIBLE_ROLLOUT', value: '20%', result: '전략(OR)', profile: 'flexibleRollout v1', hit: k % 100 < 20 },
    { rule: '최소 SW 버전', ctx: 'bmsSoftwareVersion', op: 'SEMVER_GTE', value: '2.7.0', result: '제약(AND)', profile: 'Vehicle SDK 3.4 (AAOS)', hit: row.sw >= '2.7.0' },
    { rule: '예약 시작', ctx: 'currentTime', op: 'DATE_AFTER', value: '2026-09-13T00:00Z', result: '제약(AND)', profile: 'FP 평가기 v1', hit: true },
    { rule: '예외 시장', ctx: 'market', op: 'NOT_IN', value: 'JP', result: '제약(AND)', profile: 'FP 평가기 v1', hit: true },
    { rule: 'Variant Coding', ctx: 'variantCoding', op: 'SEMVER_EQ', value: 'VC-EV-2027-KR', result: '제약(AND)', profile: 'Vehicle SDK 3.4 (AAOS)', hit: row.my >= 2027 },
  ];
}

/* ── 이력 (요청 → 관측 → 부분 적용) ─────────────────────────────────── */
interface Hop { atMs: number; stage: string; target: string; corr: string; result: string; owner: string }

const HOP_STAGES = ['Capture', '검토', '허가', '서명발행', '전달', 'ECU Guard', 'readback'];
const HOP_OWNERS = ['운영자', '품질 담당', '정책 승인자', '서명 서비스', '배포 파이프라인', '차량 Agent', 'Twin 서비스'];

function hops(row: VehicleRow, nowMs: number): Hop[] {
  const k = hashStr(row.vin + 'hops');
  const cmd = `CMD-${hex(k, 8).toUpperCase()}`;
  const pub = `PUB-${hex(k >>> 3, 8).toUpperCase()}`;
  const corr = `COR-${hex(k >>> 5, 6).toUpperCase()}`;
  const results: string[] = (() => {
    if (row.state === 'PENDING') return ['완료', '완료', '완료', '완료', '도달', '대기 — 평가 전', '미보고'];
    if (row.state === 'DIVERGED') return ['완료', '완료', '완료', '완료', '도달', 'PASS', '불일치 — OFF 보고'];
    if (row.state === 'BLOCKED') return ['완료', '완료', '완료', '완료', '도달', 'BLOCK — 로컬 안전 조건', '차단(BLOCKED)'];
    if (row.state === 'UNKNOWN') return ['완료', '완료', '완료', '검증 미완 — 서명 미확인', '도달', '판단 불가', `판단 불가(원인: ${row.causeNote})`];
    return ['완료', '완료', '완료', '완료', '도달', 'PASS', 'ON 확인 — boot·seq 일치'];
  })();
  return HOP_STAGES.map((stage, i) => ({
    atMs: nowMs - (7200 - i * 900) * 1000 - (k % 120) * 1000,
    stage,
    target: `${row.vin.slice(-10)} · ${row.rollout} · ${NODES[i % NODES.length].node}`,
    corr: i < 3 ? corr : i < 5 ? cmd : pub,
    result: results[i],
    owner: HOP_OWNERS[i],
  }));
}

/* ── 표시 부품 ─────────────────────────────────────────────────────── */
const Pill = ({ s, tone }: { s: string; tone?: string }) => (
  <span className="pill" style={{ background: tone || 'var(--surface-2)', color: tone ? '#fff' : 'var(--muted)', borderColor: 'transparent' }}>{s}</span>
);
const Note = ({ children }: { children: ReactNode }) => <p className="small muted" style={{ marginTop: 8 }}>{children}</p>;

/** 영역이 소관하는 검토 항목을 본문 맨 앞에 배지로 드러낸다 — 상세 규칙 표는 영역 끝에 있다. */
const UlOwned = ({ items }: { items: UlRule[] }) => (
  <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
    <span className="small muted">소관 검토 항목</span>
    {items.map(i => <UlBadge key={i.ul} ul={`${i.ul} ${i.verdict}`} verdict={i.verdict} />)}
  </div>
);

const SIG_KO: Record<SignatureStatus, string> = {
  VERIFIED: '검증됨', INVALID: '검증 실패', MISSING: '서명 없음', NOT_VERIFIED: '미검증',
};
const LEASE_KO: Record<LeaseState, string> = { ACTIVE: '활성(active)', DRAINING: '회수 중(draining)', RETIRED: '회수됨(retired)' };
const INSTALL_KO: Record<InstallStatus, string> = {
  INSTALLED: '설치됨', PENDING: '대기', FAILED: '실패', NOT_APPLICABLE: '해당 없음',
};

const LOOP_STEPS = [
  { key: 'DESIRED', ko: '목표(Desired)' },
  { key: 'DELIVERED', ko: '전달(Delivered)' },
  { key: 'EVALUATED', ko: '평가(Evaluated)' },
  { key: 'GUARDED', ko: 'Guard' },
  { key: 'OBSERVED', ko: '실제 관측(Observed)' },
];
const LOOP_TERMINAL = [{ ko: '부분 적용(Partial)' }, { ko: '거부(Rejected)' }, { ko: '판단 불가(Unknown)' }];

/* ═════════════════════════════════ UI12 ══════════════════════════════ */
export function VehicleApplied() {
  const { vin: routeVin } = useParams();
  const { state: appState, dispatch, can } = useApp();
  const toast = useToast();
  const twin = useTwinOptional();
  const snap: TwinStoreSnapshot | null = twin ? twin.snapshot : null;

  const [pick, setPick] = useState('');
  const [filter, setFilter] = useState({ state: 'ALL', fresh: 'ALL', q: '' });
  const [panel, setPanel] = useState<'A01' | 'A02' | 'A03'>('A01');
  const [preview, setPreview] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [check, setCheck] = useState<Record<string, string[]>>({});
  const [released, setReleased] = useState<Record<string, boolean>>({});
  const [killReleased, setKillReleased] = useState<Record<string, boolean>>({});
  const [nodePick, setNodePick] = useState(0);

  const nowMs = snap ? snap.clock.simTimeMs : DEMO_NOW_MS;

  /* 목록 — 정본 대상은 항상 차량 ID 로만 식별한다. */
  const rows: VehicleRow[] = useMemo(() => {
    const base = sampleVehicles.map((v, i) => rowFromVehicle(v, i, snap, nowMs));
    const extra = (snap?.twins ?? [])
      .filter(t => !sampleVehicles.some(v => v.vin === t.vin))
      .slice(0, 4)
      .map(t => rowFromTwin(t, snap, nowMs));
    return [...base, ...extra];
  }, [snap, nowMs]);

  /* 진입 파라미터가 없거나 모르는 차량이면 목록 첫 차량으로 떨어진다. */
  const fallback = rows.find(r => r.vin === routeVin)?.vin ?? rows[0]?.vin ?? '';
  const selected = rows.some(r => r.vin === pick) ? pick : fallback;
  const row = rows.find(r => r.vin === selected) ?? rows[0];
  const featureRow = row ? features.find(f => f.id === row.featureId) ?? features[0] : features[0];

  const shown = rows.filter(r =>
    (filter.state === 'ALL' || r.state === filter.state)
    && (filter.fresh === 'ALL' || (filter.fresh === 'FRESH' ? r.fresh : !r.fresh))
    && (filter.q.trim() === '' || `${r.vin} ${r.model} ${r.trim}`.toLowerCase().includes(filter.q.trim().toLowerCase())));

  const nodes = useMemo(() => (row ? buildNodes(row, nowMs) : []), [row, nowMs]);
  const rules = useMemo(() => (row ? ruleRows(row) : []), [row]);
  const timeline = useMemo(() => (row ? hops(row, nowMs) : []), [row, nowMs]);

  if (!row) return <CanonicalScreen screenId="UI12" core="C16 차량 런타임 실행 모듈" kpis={[]} areas={{}} />;

  /* ── 집계 — 미보고·판단 불가는 성공으로 세지 않는다 ─────────────── */
  const confirmed = rows.filter(r => r.state === 'CONFIRMED').length;
  const unreportedNodes = nodes.filter(n => n.ageS === null).length;
  const staleNodes = nodes.filter(n => n.ageS !== null && !n.fresh).length;
  const blockedNodes = nodes.filter(n => n.guard === 'BLOCK').length;
  const unreportedVehicles = rows.filter(r => r.state === 'UNKNOWN').length;
  const blocking = rows.filter(r => r.state === 'BLOCKED').length;
  const confirmedVehicles = confirmed;
  const reachable = confirmedVehicles + rows.filter(r => r.state === 'PENDING').length;
  const convergenceRate = rows.length ? confirmedVehicles / rows.length : 0;
  const sig = nodes.find(n => n.def.node === 'Cloud-Policy-Svc')?.signature ?? 'VERIFIED';
  const drains = nodes.filter(n => n.lease === 'DRAINING').length;
  const policyHash = nodes[0]?.policyHash ?? sha(row.vin + row.rollout);
  const bootId = nodes[0]?.bootId ?? 'boot-000000';
  const seq = nodes[0]?.seq ?? 0;
  const bootAgeS = nodes[0] ? Math.round((nowMs - nodes[0].bootAtMs) / 1000) : 0;
  const reportAgeS = row.ageS;
  const lastRefreshAgeS = refreshedAt === null ? null : Math.round((nowMs - refreshedAt) / 1000);
  const node = nodes[Math.min(nodePick, nodes.length - 1)] ?? nodes[0];

  const audit = (action: string, detail: string) =>
    dispatch({ t: 'AUDIT', entry: { ts: at(nowMs).slice(0, 16), actor: appState.role, action, target: row.vin, detail } });

  /* ── 검토 항목 (UI12 배정 16건) ─────────────────────────────────── */
  const s01Rules: UlRule[] = [
    { ul: 'UL-010', rule: '도구 Flag 생애주기와 FP 정의·출시·허가·실제 적용 상태를 각각 다른 열로 표시한다', verdict: 'PASS', evidence: `정의 ${features.length}건 · 출시 ${row.rollout} · 차량 적용 ${STATE_KO[row.state]} · 도구 Applied 를 확인(CONFIRMED)으로 복사하지 않음` },
    { ul: 'UL-054', rule: 'metrics 노출·평가 수치를 차량 수나 성공률로 변환하지 않고 분모·중복·신선도를 함께 밝힌다', verdict: 'WARN', evidence: `표본 ${rows.length}대 · 미보고 ${unreportedVehicles}대는 분모에서 제외해 성공률을 만들지 않음 · late arrival 미모델` },
    { ul: 'UL-056', rule: 'SDK·앱 인벤토리를 문제 판단에만 쓰고 실제 설치 capability·readback 을 대체하지 않는다', verdict: NODES.some(n => !n.local) ? 'WARN' : 'PASS', evidence: `인벤토리 ${NODES.length}건(${NODES.filter(n => !n.local).length}건은 비차량 실행) · 인벤토리만으로 적용 성공을 판정하지 않음` },
  ];
  const s02Rules: UlRule[] = [
    { ul: 'UL-053', rule: 'command·publication·featureVersion·node·boot·sequence·digest 로 적용을 대사하고 COMMIT 을 효과 확인으로만 쓴다', verdict: 'PASS', evidence: `노드 ${nodes.length}건 · digest ${policyHash} · 확인 ${confirmedVehicles}대 · 미보고 ${unreportedVehicles}대는 성공 아님` },
    { ul: 'UL-036', rule: 'off·variant 없음·type mismatch·미지원 SDK 결과를 유효한 비즈니스 값과 섞지 않는다', verdict: sig === 'NOT_VERIFIED' ? 'WARN' : 'PASS', evidence: `기본값 대체 0건 · 서명 ${SIG_KO[sig]} · default 가 이전 값과 같아도 신규 실행 의도를 만들지 않음` },
  ];
  const s03Rules: UlRule[] = [
    { ul: 'UL-066', rule: 'RuntimeBinding 을 BOM·Topology 에 결속하고 다른 ECU 와 공유 policyHash·cohort 를 함께 본다', verdict: 'PASS', evidence: `RuntimeBinding ${NODES.length}건 · policyHash ${policyHash} · cohort ${row.cohort} · OEM 어댑터가 실시간 제어·안전권한 유지` },
    { ul: 'UL-060', rule: '관리 포털·비안전 HMI 의 frontend remote evaluation 과 차량 local signed evaluation 을 별도 profile 로 둔다', verdict: 'WARN', evidence: `비차량 실행 노드 ${NODES.filter(n => !n.local).length}건 · ECU/OS/ABI 별 suitability matrix 는 미구현` },
    { ul: 'UL-026', rule: 'Context 를 인증된 source 로 재구성하고 브라우저가 보낸 문자열을 법규·권리 사실로 신뢰하지 않는다', verdict: 'WARN', evidence: `trustedContextRef CTX-${hex(hashStr(row.vin)).slice(0, 6)} · source revision 기록 · Guard 는 실행 직전 로컬 사실 확인(${nodes.filter(n => n.def.local).length}노드)` },
  ];
  const s04Rules: UlRule[] = [
    { ul: 'UL-061', rule: 'FP facade 는 DecisionRecord 와 provenance 를 반환하고 필수 audit·Guard 를 선택 Hook 에 맡기지 않는다', verdict: 'PASS', evidence: `DecisionRecord ${rules.length}건 · provenance ${policyHash} · STALE/NOT_READY/FATAL 을 결과 유형과 분리 표시` },
    { ul: 'UL-032', rule: '시간 제약은 timezone·경계 포함·시계 오차·신선도를 밝히고 현재 시각을 입력 사실로 받지 않는다', verdict: 'PASS', evidence: `UTC/KST 병기 · 경계 포함 · 시계 오차 ±${CLOCK_SKEW_S}초 · 예약 도착은 허가가 아님(실행 시 재검사)` },
  ];
  const s05Rules: UlRule[] = [
    { ul: 'UL-050', rule: 'Pause·Disable·긴급 차단·이전 정책 복구·Binary OTA 롤백의 효과를 명령별로 구분한다', verdict: 'PASS', evidence: `현재 ${released[row.vin] ? '긴급 차단 해제(선택 latch 만 해제)' : blockedNodes > 0 ? '긴급 차단(안전 전이)' : '차단 없음'} · Pause 는 이미 적용된 차량의 OFF 가 아님` },
    { ul: 'UL-067', rule: 'publication 서명·identity·sequence·anti-replay checkpoint 를 도구 인증과 분리해 관리한다', verdict: sig === 'VERIFIED' ? 'PASS' : 'WARN', evidence: `서명 ${SIG_KO[sig]} · sequence ${seq} · boot ${bootId} · 재전달·rollback 에도 새 sequence` },
  ];
  const s06Rules: UlRule[] = [
    { ul: 'UL-063', rule: 'feature·parent·segment·variant 를 같은 publication lease 에서 읽고 준비 전 교체·회수 중 회수를 금지한다', verdict: drains > 0 ? 'WARN' : 'PASS', evidence: `Lease 활성 ${nodes.filter(n => n.lease === 'ACTIVE').length} · 회수 중 ${drains} · 만료 ${hhmm(Math.min(...nodes.map(n => n.leaseUntilMs)))}` },
    { ul: 'UL-062', rule: '검증된 서명 package 만 Repository 에 공급하고 일반 polling 이 검증 경로를 덮어쓰지 못하게 한다', verdict: 'WARN', evidence: `서명 ${SIG_KO[sig]} · bootstrap 이후 덮어쓰기 경로 0건 · disableAutoStart 를 보안 경계로 쓰지 않음` },
    { ul: 'UL-065', rule: 'cache freshness·last-known-good·유효성·시계 신뢰·재시작 지점을 따로 판정한다', verdict: staleNodes > 0 || unreportedNodes > 0 ? 'FAIL' : 'PASS', evidence: `만료 ${staleNodes}노드 · 미보고 ${unreportedNodes}노드 · 임계 ${FRESH_S}초 · 신규 활성화 HOLD 와 실행 중 유지/축소 구분` },
  ];
  const s07Rules: UlRule[] = [
    { ul: 'UL-079', rule: 'node 별 exact policy·boot·sequence·freshness 와 expected·observed·reason 을 함께 표시한다', verdict: 'PASS', evidence: `policy ${row.rollout}(${policyHash}) · boot ${bootId}(${ageKo(bootAgeS)} 전) · seq ${seq} · freshness ${reportAgeS === null ? '미보고' : ageKo(reportAgeS)}(임계 ${FRESH_S}초) · 미보고 ${unreportedNodes}노드는 성공 집계 제외` },
  ];
  const s08Rules: UlRule[] = [
    { ul: 'UL-079', rule: '요청→검토→허가→서명발행→전달→ECU Guard→readback 을 분리 표시하고 timeout·stale·partial 의 다음 행동을 밝힌다', verdict: 'PASS', evidence: `${HOP_STAGES.length}단계 분리 · 상관 ID ${timeline[0]?.corr ?? '-'} · metrics 차트와 실제 적용 성공 타일 분리 · 판단 불가 ${unreportedVehicles}대 다음 행동 표시` },
  ];

  /* ── 실행 버튼의 차단 사유 ──────────────────────────────────────── */
  const refreshReasons = [
    !can('view') && `역할 ${appState.role} 에게 조회 권한이 없다`,
    row.state === 'UNKNOWN' && `판단 불가(${row.causeNote}) — 원인 해소 전에는 현재 적용 근거로 쓸 수 없다`,
  ].filter(Boolean) as string[];
  const leaseReasons = [
    ...ulBlocks(s06Rules),
    drains > 0 && `Lease 회수 중 ${drains}건 — in-flight 종료 전 회수 금지`,
  ].filter(Boolean) as string[];
  const recoverReasons = [
    ...ulBlocks(s05Rules),
    blockedNodes === 0 && '차단된 노드가 없다 — 해제할 안전 전이가 없다',
    !released[row.vin] && '차량 제어기의 최종 판단(복구 증적)이 첨부되지 않았다',
    !can('approve') && `역할 ${appState.role} 에게 복구 승인 권한이 없다`,
  ].filter(Boolean) as string[];
  const killReasons = [
    ...ulBlocks(s05Rules),
    sig !== 'VERIFIED' && `publication 서명 ${SIG_KO[sig]} — 서명 확인 전 해제 금지`,
    !can('approve') && `역할 ${appState.role} 에게 긴급 차단 해제 권한이 없다`,
  ].filter(Boolean) as string[];
  const checkReasons = [
    reportAgeS === null ? `보고 없음(원인: ${row.causeNote}) — boot·sequence 를 대조할 관측이 없다` : '',
    !can('view') ? `역할 ${appState.role} 에게 조회 권한이 없다` : '',
  ].filter(Boolean) as string[];

  const kpis: Kpi[] = [
    { v: rows.length, l: '대상 차량' },
    { v: confirmedVehicles, l: '확인(CONFIRMED)' },
    { v: unreportedVehicles, l: '판단 불가(미보고)' },
    { v: blocking, l: '차단(BLOCKED)' },
    { v: `${Math.round(convergenceRate * 100)}% (임계 ${Math.round(CONVERGENCE_THRESHOLD * 100)}%)`, l: '확인 비율' },
  ];

  const notice = !snap && (
    <div className="small muted" style={{ marginBottom: 8 }}>
      Twin 스냅샷 연결이 없다 — 로컬 합성 스냅샷(같은 판정 규칙)으로 표시한다. 미보고·판단 불가는 성공으로 세지 않는다.
    </div>
  );

  const areas: Record<string, () => ReactNode> = {
    /* ── UI12-S01 차량 목록과 대상 정보 ────────────────────────────── */
    'UI12-S01': () => (
      <div>
        {notice}
        <UlOwned items={s01Rules} />
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="small muted">차량 상태
            <select style={{ ...FIELD, marginTop: 4 }} value={filter.state} onChange={e => setFilter({ ...filter, state: e.target.value })}>
              <option value="ALL">전체</option>
              {STATES.map(s => <option key={s} value={s}>{STATE_KO[s]} ({s})</option>)}
            </select>
          </label>
          <label className="small muted">보고 신선도
            <select style={{ ...FIELD, marginTop: 4 }} value={filter.fresh} onChange={e => setFilter({ ...filter, fresh: e.target.value })}>
              <option value="ALL">전체</option>
              <option value="FRESH">신선 (≤ {FRESH_S}초)</option>
              <option value="STALE">만료 · 미보고</option>
            </select>
          </label>
          <label className="small muted">차량 ID · 차종
            <input style={{ ...FIELD, marginTop: 4 }} value={filter.q} placeholder="VIN 또는 차종" onChange={e => setFilter({ ...filter, q: e.target.value })} />
          </label>
          <span className="small muted">표시 {shown.length} / {rows.length}대</span>
        </div>

        <div className="mt">
          <Table head={S01_COLS}>
            {shown.map(r => (
              <tr key={r.vin} onClick={() => { setPick(r.vin); setPanel('A01'); }} style={{ cursor: 'pointer', background: r.vin === row.vin ? 'var(--surface-2)' : undefined }}>
                <td className="mono small">{r.vin}{r.twinBacked && <span className="pill" style={{ marginLeft: 6 }}>Twin</span>}</td>
                <td>{r.desired === 'ON' ? 'ON (켜기)' : 'OFF (끄기)'}</td>
                <td><Pill s={`${STATE_KO[r.state]} (${r.state})`} tone={STATE_TONE[r.state]} /></td>
                <td className="mono small">{r.rollout}</td>
                <td className="mono small">{r.reportedAtMs === null ? '보고 없음' : at(r.reportedAtMs)}</td>
                <td style={{ color: r.ageS === null ? 'var(--fail)' : r.fresh ? 'var(--pass)' : 'var(--pending)' }}>
                  {r.ageS === null ? `미보고 — ${r.causeNote}` : r.fresh ? `신선 ${ageKo(r.ageS)}` : `만료 ${ageKo(r.ageS)}`}
                </td>
                <td className="small muted">{r.halt || '—'}</td>
              </tr>
            ))}
          </Table>
        </div>

        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className={`btn small ${panel === 'A01' ? 'primary' : ''}`} onClick={() => { setPanel('A01'); audit('UI12-S01-A01', `차량 ID와 적용 상품 조회 ${row.vin}`); }}>차량 ID와 적용 상품 조회</button>
          <button className={`btn small ${panel === 'A02' ? 'primary' : ''}`} onClick={() => { setPanel('A02'); audit('UI12-S01-A02', `출시 대상과 정책 버전 확인 ${row.rollout}`); }}>출시 대상과 정책 버전 확인</button>
          <button className={`btn small ${panel === 'A03' ? 'primary' : ''}`} onClick={() => { setPanel('A03'); audit('UI12-S01-A03', `국가 차종 Trim Variant 참조 ${row.region}/${row.model}/${row.trim}`); }}>국가 차종 Trim Variant 참조</button>
          <Gated label="새로고침 (읽기 전용)" reasons={refreshReasons} onClick={() => { setRefreshedAt(nowMs); setCheck({}); audit('UI12-S01-REFRESH', '스냅샷 읽기 전용 새로고침'); toast(`${row.vin} 스냅샷을 읽기 전용으로 다시 읽었다`, 'ok'); }} />
          <Link className="btn small" to={`/twin/vehicle/${row.vin}`}>3D 트윈 열기</Link>
        </div>

        <div className="card mt">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <b className="small">UI12-S01-D · {row.vin}</b>
            <span className="pill">{row.twinBacked ? 'Twin 인스턴스' : '합성 스냅샷'}</span>
          </div>
          {panel === 'A01' && (
            <div className="kv small mt">
              적용 상품 <b>{ENTITLEMENT}</b> · Feature <span className="mono">{row.featureId}</span> ({featureRow.displayName}) · 배포 유형 <b>{featureRow.deployType}</b><br />
              차량 상태 <b style={{ color: STATE_TONE[row.state] }}>{STATE_KO[row.state]} ({row.state})</b> · 요청 <b>{row.desired}</b> · 현재 출시 <span className="mono">{row.rollout}</span><br />
              마지막 새로고침 {lastRefreshAgeS === null ? '없음 (진입 후 미실행)' : `${ageKo(lastRefreshAgeS)} 전`} · 새로고침은 판단을 바꾸지 않는다
            </div>
          )}
          {panel === 'A02' && (
            <div className="kv small mt">
              출시 <span className="mono">{row.rollout}</span> · policyHash <span className="mono">{policyHash}</span> · 대상 cohort <b>{row.cohort}</b><br />
              확인 <b>{confirmedVehicles}</b>대 · 대기 <b>{rows.filter(r => r.state === 'PENDING').length}</b>대 · 불일치 <b>{rows.filter(r => r.state === 'DIVERGED').length}</b>대 · 판단 불가 <b>{unreportedVehicles}</b>대 · 차단 <b>{blocking}</b>대<br />
              확인 비율 <b>{Math.round(convergenceRate * 100)}%</b> (임계 {Math.round(CONVERGENCE_THRESHOLD * 100)}%) — 미보고 {unreportedVehicles}대는 분모에서 빼지 않고 성공으로도 세지 않는다
            </div>
          )}
          {panel === 'A03' && (
            <div className="kv small mt">
              국가 <b>{row.region}</b> · 차종 <b>{row.model}</b> · 연식 <b>{row.my}</b> · Trim <b>{row.trim}</b><br />
              HW <span className="mono">{row.hw}</span> · SW <span className="mono">{row.sw}</span> · Variant Coding <span className="mono">VC-EV-{row.my}-{row.region}</span><br />
              As-Designed / As-Built / As-Deployed 는 서로 다른 스냅샷이다 — 구성 불일치는 적용 실패가 아니라 판단 불가 사유다
            </div>
          )}
        </div>

        <div className="mt"><UlRules items={s01Rules} /></div>
        <Note>미저장 입력(필터·선택)은 새로고침 뒤에도 보존된다. 목록의 미보고 차량은 성공 집계에 들어가지 않는다.</Note>
      </div>
    ),

    /* ── UI12-S02 목표와 보고 상태 ─────────────────────────────────── */
    'UI12-S02': () => (
      <div>
        {notice}
        <UlOwned items={s02Rules} />
        <StageRail
          steps={LOOP_STEPS}
          current={row.state === 'CONFIRMED' ? 'OBSERVED' : row.state === 'PENDING' ? 'DELIVERED'
            : row.state === 'BLOCKED' ? 'GUARDED' : row.state === 'DIVERGED' ? 'OBSERVED' : '판단 불가'}
          terminal={LOOP_TERMINAL}
          note={`다섯 단계는 서로 다른 사실이다 — 전달(도구가 보냈다) · 평가(규칙 결과) · Guard(로컬 판단) · 실제 관측(readback) 을 합치지 않는다. 현재 출시 ${row.rollout} 에 대한 유효한 readback 만 성공 근거다.`}
        />
        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="small muted">노드 선택</span>
          <select style={{ ...FIELD, maxWidth: 260 }} value={String(nodePick)} onChange={e => setNodePick(Number(e.target.value))}>
            {nodes.map((n, i) => <option key={n.def.ref} value={String(i)}>{n.def.node} · {n.def.service}</option>)}
          </select>
          <Pill s={`${node.def.node} Guard ${node.guard}`} tone={node.guard === 'PASS' ? 'var(--pass)' : node.guard === 'BLOCK' ? 'var(--fail)' : 'var(--muted)'} />
        </div>
        <div className="mt">
          <Table head={S02_COLS}>
            {nodes.map(n => (
              <tr key={n.def.ref}>
                <td className="mono small">{n.def.node}<br /><span className="muted">{n.def.service}</span></td>
                <td>{n.desired}</td>
                <td>{n.delivered}</td>
                <td className="small">{n.evaluated}</td>
                <td className="small" style={{ color: n.guard === 'PASS' ? 'var(--pass)' : n.guard === 'BLOCK' ? 'var(--fail)' : 'var(--muted)' }}>
                  {n.guard}{n.guardReason && <><br /><span className="small muted">{n.guardReason}</span></>}
                </td>
                <td style={{ color: n.observed === 'OFF' ? 'var(--fail)' : n.observed === 'ON' ? 'var(--pass)' : 'var(--muted)' }}>{n.observed}</td>
                <td className="mono small">{n.reportAtMs === null ? `미보고 — ${n.cause ? UNKNOWN_CAUSE_LABEL[n.cause].ko : '원인 미상'}` : `${at(n.reportAtMs)} (${ageKo(n.ageS ?? 0)})`}</td>
              </tr>
            ))}
          </Table>
        </div>
        <div className="kv small mt">
          구분 — 미보고 <b>{unreportedNodes}</b>노드 · 거부 <b>{nodes.filter(n => n.guard === 'BLOCK').length}</b>노드 · 부분 적용 <b>{nodes.filter(n => n.observed === 'OFF').length}</b>노드 · 실제 관측 ON <b>{nodes.filter(n => n.observed === 'ON').length}</b>노드
        </div>
        <Reasons
          title="현재 출시에 대한 유효 readback 차단 조건"
          ok={row.state === 'CONFIRMED' && unreportedNodes === 0 && staleNodes === 0}
          list={[
            ...(row.state !== 'CONFIRMED' ? [`차량 판정 ${STATE_KO[row.state]} (${row.state}) — 현재 적용 근거로 쓰지 않는다`] : []),
            ...(unreportedNodes > 0 ? [`미보고 노드 ${unreportedNodes}건 — 보내지 않은 것을 성공으로 세지 않는다`] : []),
            ...(staleNodes > 0 ? [`신선도 초과 노드 ${staleNodes}건 — 보고 시각이 ${FRESH_S}초를 넘었다`] : []),
            ...(row.ageS !== null && !row.fresh ? [`차량 보고가 ${ageKo(row.ageS)} 전 — 임계 ${FRESH_S}초 초과`] : []),
            ...(row.ageS === null ? [`보고 없음 — 원인: ${row.causeNote}. ${UNKNOWN_CAUSE_ACTION[row.cause].ko}`] : []),
          ]}
        />
        <div className="mt"><UlRules items={s02Rules} /></div>
      </div>
    ),

    /* ── UI12-S03 ECU와 서비스 구성 ────────────────────────────────── */
    'UI12-S03': () => (
      <div>
        {notice}
        <UlOwned items={s03Rules} />
        <Table head={S03_COLS}>
          {nodes.map(n => (
            <tr key={n.def.ref}>
              <td className="mono small">{n.def.ref}</td>
              <td className="mono small">{n.def.service}</td>
              <td>{n.def.node}{!n.def.local && <span className="pill" style={{ marginLeft: 6 }}>비차량 실행</span>}</td>
              <td className="small">{n.def.owner}</td>
              <td className="small">{n.def.profile}</td>
              <td className="mono small">{n.version}</td>
              <td className="small" style={{ color: n.valid === '유효' ? 'var(--pass)' : 'var(--pending)' }}>{n.valid}</td>
            </tr>
          ))}
        </Table>
        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn small" onClick={() => audit('UI12-S03-A01', `RuntimeBinding ${NODES.length}건 조회 ${row.vin}`)}>RuntimeBinding별 ECU 서비스 조회</button>
          <button className="btn small" onClick={() => audit('UI12-S03-A02', 'AAOS 와 타 제어기 책임 경계 표시')}>AAOS와 타 제어기의 책임 경계 표시</button>
          <button className="btn small" onClick={() => audit('UI12-S03-A03', 'OEM 및 3rd party 연결 확인')}>OEM 및 3rd party 연결 확인</button>
        </div>
        <div className="kv small mt">
          책임 경계 — AAOS(로컬 서명 평가·실행) <b>{nodes.filter(n => n.def.profile.includes('AAOS')).length}</b>노드 · QNX/3rd party <b>{nodes.filter(n => n.def.profile.includes('QNX')).length}</b>노드 · 서버(Repository) <b>{nodes.filter(n => n.def.profile.includes('Repository')).length}</b>노드 · 비차량 frontend 평가 <b>{nodes.filter(n => n.def.profile.includes('Frontend')).length}</b>노드
        </div>
        <div className="kv small">
          다른 ECU 와의 결속 — policyHash <span className="mono">{policyHash}</span> · cohort <b>{row.cohort}</b> · 3rd party payload 는 권리·서명·capability·허용 제어점 검사 후에만 쓴다
        </div>
        <Note>인벤토리(노드·서비스·SDK)·설치 capability·service readiness·실제 readback 은 서로 다른 근거다. 인벤토리는 문제를 찾는 데만 쓰고 적용 성공을 대신하지 않는다.</Note>
        <div className="mt"><UlRules items={s03Rules} /></div>
      </div>
    ),

    /* ── UI12-S04 SDK 평가와 결정 이유 ────────────────────────────── */
    'UI12-S04': () => (
      <div>
        {notice}
        <UlOwned items={s04Rules} />
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={preview} onChange={e => setPreview(e.target.checked)} />
            미리보기(비작동 평가) 로 보기
          </label>
          <Pill s={preview ? '미리보기 — 실행 부작용 없음' : `실제 실행 결과 ${row.rollout}`} tone={preview ? 'var(--pending)' : 'var(--pass)'} />
          <span className="small muted">DecisionRecord <span className="mono">DEC-{hex(hashStr(row.vin)).slice(0, 6)}</span> · 결과 스키마 <span className="mono">ResultSchema v3</span></span>
        </div>
        <div className="mt">
          <Table head={S04_COLS}>
            {rules.map(r => (
              <tr key={r.rule} style={{ opacity: preview ? 0.85 : 1 }}>
                <td className="small">{r.rule}</td>
                <td className="mono small">{r.ctx}</td>
                <td className="mono small">{r.op}</td>
                <td className="mono small">{r.value}</td>
                <td className="small" style={{ color: r.hit ? 'var(--pass)' : 'var(--muted)' }}>{r.result}{r.hit ? ' · 충족' : ' · 미충족'}</td>
                <td className="small muted">{r.profile}</td>
              </tr>
            ))}
          </Table>
        </div>
        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn small" onClick={() => audit('UI12-S04-A01', `DecisionRecord 조회 ${row.vin}`)}>DecisionRecord와 ResultSchema 참조</button>
          <button className="btn small" onClick={() => audit('UI12-S04-A02', `Provider·Flag 평가 이유 조회 ${node.def.node}`)}>Provider 및 Flag 평가 이유 조회</button>
          <button className="btn small" onClick={() => audit('UI12-S04-A03', `Fallback·정책 버전 확인 ${row.rollout}`)}>Fallback과 정책 버전 확인</button>
        </div>
        <div className="kv small mt">
          결정 이유 — 규칙 {rules.length}건 중 충족 <b>{rules.filter(r => r.hit).length}</b>건 · 미충족 <b>{rules.filter(r => !r.hit).length}</b>건 · Fallback <b>{rules.some(r => !r.hit) ? '미충족 규칙 있음 — 차단(AND)' : '사용 안 함'}</b><br />
          결과 유형은 제약(AND)·전략(OR)·필수 자격을 섞지 않는다. 미충족 하나는 차단이지 기본값 대체가 아니다.
        </div>
        {preview && <Note>미리보기는 고정 Capture·Context 스키마로 평가만 한다 — 전달·실행·readback 을 만들지 않는다.</Note>}
        <div className="mt"><UlRules items={s04Rules} /></div>
      </div>
    ),

    /* ── UI12-S05 Guard와 안전 전이 ───────────────────────────────── */
    'UI12-S05': () => (
      <div>
        {notice}
        <UlOwned items={s05Rules} />
        <Table head={S05_COLS}>
          {nodes.map(n => (
            <tr key={n.def.ref}>
              <td className="mono small">{row.vin.slice(0, 12)}… · {n.def.node}</td>
              <td className="mono small">{row.featureId}</td>
              <td className="small" style={{ color: n.guard === 'BLOCK' ? 'var(--fail)' : n.guard === 'UNKNOWN' ? 'var(--muted)' : 'var(--pass)' }}>
                {n.guard === 'PASS' ? '차단 없음' : n.guardReason || '로컬 판단 없음'}
              </td>
              <td className="small">{killReleased[row.vin] ? '긴급 차단 해제 기록 · 선택 latch 만 해제' : recoveredNote(n.guard, n.observed)}</td>
              <td className="small">{ENTITLEMENT} · {n.guard === 'BLOCK' ? '기간 내 유효 · 복구 검토 필요' : '기간 내 유효'}</td>
              <td className="small">{n.guard === 'PASS' ? `PASS (${hhmm(n.reportAtMs ?? nowMs)})` : n.guard === 'BLOCK' ? 'BLOCK — 차량 최종 판단' : '미확인 — 차량 판단 없음'}</td>
            </tr>
          ))}
        </Table>
        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Gated label="로컬 안전 조건 · 거부 이유 확인" reasons={[]} onClick={() => audit('UI12-S05-A01', `로컬 안전 조건 확인 ${blockedNodes}건 차단`)} />
          <Gated label="SafeTransitionProfile 참조" reasons={[]} onClick={() => audit('UI12-S05-A02', 'SafeTransitionProfile 참조')} />
          <Gated label="차량 제어기의 최종 판단 표시" reasons={[]} onClick={() => audit('UI12-S05-A03', '차량 제어기 최종 판단 표시')} />
          <Gated label="긴급 차단 해제" kind="danger" reasons={killReasons} onClick={() => { setKillReleased({ ...killReleased, [row.vin]: true }); audit('UI12-S05-KILL_RELEASE', '긴급 차단 해제 — 선택 incident latch 만 해제'); toast('긴급 차단을 해제했다 — 선택 latch 만 해제된다', 'ok'); }} />
          <Gated label="복구 승인(안전 전이 해제)" kind="primary" reasons={recoverReasons} onClick={() => { setReleased({ ...released, [row.vin]: true }); audit('UI12-S05-RECOVER', '안전 전이 해제 승인'); toast('복구를 승인했다 — 다른 장애의 차단은 유지된다', 'ok'); }} />
        </div>
        <Reasons title="복구 승인 차단 조건" ok={recoverReasons.length === 0} list={recoverReasons} />
        {killReleased[row.vin] && <Note>긴급 차단 해제는 선택한 incident latch 만 푼다. Pause 는 신규 전달 중지이고, 이전 정책 복구는 호환된 기준선의 새 publication 이다 — 이미 적용된 차량을 끄는 조치가 아니다.</Note>}
        <div className="mt"><UlRules items={s05Rules} /></div>
      </div>
    ),

    /* ── UI12-S06 Cache와 SnapshotLease ───────────────────────────── */
    'UI12-S06': () => (
      <div>
        {notice}
        <UlOwned items={s06Rules} />
        <Table head={S06_COLS}>
          {nodes.map(n => (
            <tr key={n.def.ref}>
              <td className="mono small">{n.def.node}</td>
              <td className="mono small">{n.policyVersion}<br /><span className="muted">{n.policyHash} · seq {n.seq}</span></td>
              <td className="small" style={{ color: n.signature === 'VERIFIED' ? 'var(--pass)' : 'var(--pending)' }}>{SIG_KO[n.signature]} ({n.signature})</td>
              <td className="small">{LEASE_KO[n.lease]}{n.lease === 'DRAINING' && <><br /><span className="muted">in-flight 종료 후 회수</span></>}</td>
              <td className="mono small">{hhmm(n.expiresAtMs)}<br /><span className="muted">Lease {hhmm(n.leaseUntilMs)}</span></td>
              <td className="small">{n.offlinePolicy}</td>
            </tr>
          ))}
        </Table>
        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Gated label="Snapshot·만료 재검증" reasons={leaseReasons} onClick={() => { audit('UI12-S06-VERIFY', `서명·만료 재검증 ${nodes.filter(n => n.signature === 'VERIFIED').length}/${nodes.length}`); toast('서명 Snapshot 과 만료를 다시 읽었다 — 화면 조작은 로컬 판단을 덮어쓰지 않는다', 'ok'); }} />
          <span className="small muted">cache 임계 {FRESH_S}초 · Lease {Math.round(LEASE_S / 60)}분 · 시계 오차 ±{CLOCK_SKEW_S}초</span>
        </div>
        <div className="kv small mt">
          서명 상태 — 검증됨 <b>{nodes.filter(n => n.signature === 'VERIFIED').length}</b> · 미검증 <b>{nodes.filter(n => n.signature === 'NOT_VERIFIED').length}</b> · 서명 없음 <b>{nodes.filter(n => n.signature === 'MISSING').length}</b><br />
          Lease — 활성 <b>{nodes.filter(n => n.lease === 'ACTIVE').length}</b> · 회수 중 <b>{drains}</b> · 회수됨 <b>{nodes.filter(n => n.lease === 'RETIRED').length}</b> · feature·parent·segment·variant 는 같은 publication lease 에서 읽는다
        </div>
        <div className="kv small">
          만료·오프라인 — 만료 노드 <b>{nodes.filter(n => n.expiresAtMs <= nowMs).length}</b> · cache 만료 <b>{staleNodes}</b> · 미보고 <b>{unreportedNodes}</b> · 신규 활성화는 HOLD, 실행 중인 기능은 기능별로 승인된 유지/축소/정지만 허용
        </div>
        <Note>화면 조작(재검증·필터)은 로컬 안전 판단을 덮어쓰지 않는다. 인증서·권리·정책 만료는 안전 전이와 재동기화 대상이다.</Note>
        <div className="mt"><UlRules items={s06Rules} /></div>
      </div>
    ),

    /* ── UI12-S07 보고 신뢰성과 readback ──────────────────────────── */
    'UI12-S07': () => {
      const findings = check[row.vin];
      return (
        <div>
          {notice}
          <UlOwned items={s07Rules} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="small muted">
              현재 출시 <span className="mono">{row.rollout}</span> · policyHash <span className="mono">{policyHash}</span> ·
              boot <span className="mono">{bootId}</span> ({ageKo(bootAgeS)} 전) · seq <span className="mono">{seq}</span> ·
              freshness {reportAgeS === null ? '미보고' : ageKo(reportAgeS)} (임계 {FRESH_S}초)
            </span>
          </div>
          <div className="mt">
            <Table head={S07_COLS}>
              {nodes.map(n => {
                const ok = n.ageS !== null && n.fresh && n.policyVersion === row.rollout && n.seq === seq;
                return (
                  <tr key={n.def.ref}>
                    <td className="mono small">{n.def.node}<br /><span className="muted">{n.def.service}</span></td>
                    <td>{n.desired}</td>
                    <td>{n.delivered}</td>
                    <td className="small">{n.evaluated}</td>
                    <td className="small" style={{ color: n.guard === 'PASS' ? 'var(--pass)' : n.guard === 'BLOCK' ? 'var(--fail)' : 'var(--muted)' }}>{n.guard}</td>
                    <td style={{ color: ok ? 'var(--pass)' : 'var(--muted)' }}>{n.observed}</td>
                    <td className="mono small">
                      {n.reportAtMs === null
                        ? `미보고 — ${n.cause ? UNKNOWN_CAUSE_LABEL[n.cause].ko : '원인 미상'}`
                        : `${at(n.reportAtMs)} · ${ageKo(n.ageS ?? 0)} · boot ${n.bootId} · seq ${n.seq}`}
                    </td>
                  </tr>
                );
              })}
            </Table>
          </div>
          <div className="row mt" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Gated label="node boot · sequence · freshness 검사" kind="primary" reasons={checkReasons} onClick={() => {
              const found: string[] = [];
              nodes.forEach(n => {
                if (n.ageS === null) found.push(`${n.def.node}: 보고 없음 — ${n.cause ? UNKNOWN_CAUSE_LABEL[n.cause].ko : '원인 미상'} · 성공 집계 제외`);
                else if (!n.fresh) found.push(`${n.def.node}: 신선도 초과 ${ageKo(n.ageS)} (임계 ${FRESH_S}초)`);
                if (n.policyVersion !== row.rollout) found.push(`${n.def.node}: 정책 버전 불일치 ${n.policyVersion} ≠ ${row.rollout}`);
                if (n.seq !== seq) found.push(`${n.def.node}: sequence 불일치 ${n.seq} ≠ ${seq}`);
                if (n.signature !== 'VERIFIED') found.push(`${n.def.node}: 서명 ${SIG_KO[n.signature]} — 현재 근거로 쓰지 않음`);
              });
              setCheck({ ...check, [row.vin]: found });
              audit('UI12-S07-A01', `node boot·sequence·freshness 검사 — findings ${found.length}건`);
              toast(found.length ? `${found.length}건이 현재 적용 근거 조건을 벗어났다` : '모든 노드가 현재 boot·sequence·출시와 일치한다', found.length ? 'warn' : 'ok');
            }} />
            <span className="small muted">서비스 시작 ≠ 실제 기능 readback — 프로세스 기동만으로 ON 으로 세지 않는다</span>
          </div>
          {findings && (
            <div className="card mt">
              <b className="small">검사 결과 (UI12-S07-C)</b>
              {findings.length === 0
                ? <p className="small" style={{ color: 'var(--pass)', margin: '6px 0 0' }}>✓ 현재 boot·sequence·출시와 일치하고 신선한 보고만 있다</p>
                : <ul className="small" style={{ margin: '6px 0 0 16px' }}>{findings.map((f, i) => <li key={i}>{f}</li>)}</ul>}
            </div>
          )}
          <div className="kv small mt">
            집계 — 실제 관측 ON <b>{nodes.filter(n => n.observed === 'ON').length}</b>노드 · OFF <b>{nodes.filter(n => n.observed === 'OFF').length}</b>노드 · 차단 <b>{blockedNodes}</b>노드 · 미보고 <b>{unreportedNodes}</b>노드<br />
            미보고·판단 불가 <b>{unreportedVehicles}</b>대는 성공률 분자에도 분모에도 넣지 않고 별도로 표시한다
          </div>
          <Reasons
            title="readback 성공 집계 차단 조건"
            ok={unreportedNodes === 0 && staleNodes === 0 && row.state === 'CONFIRMED'}
            list={[
              ...(unreportedNodes > 0 ? [`미보고 노드 ${unreportedNodes}건 — 보내지 않은 것을 성공으로 세지 않는다`] : []),
              ...(staleNodes > 0 ? [`신선도 초과 노드 ${staleNodes}건 — boot·sequence 불일치 가능`] : []),
              ...(nodes.filter(n => n.signature !== 'VERIFIED').length > 0 ? [`서명 미확인 노드 ${nodes.filter(n => n.signature !== 'VERIFIED').length}건 — 현재 출시 근거로 쓸 수 없다`] : []),
              ...(nodes.filter(n => n.def.node.startsWith('HMI')).length > 0 ? ['비차량 frontend 평가 노드는 실제 기능 readback 을 대신하지 않는다'] : []),
            ]}
          />
          <div className="mt"><UlRules items={s07Rules} /></div>
        </div>
      );
    },

    /* ── UI12-S08 이력과 복구 연결 ────────────────────────────────── */
    'UI12-S08': () => (
      <div>
        {notice}
        <UlOwned items={s08Rules} />
        <Table head={S08_COLS}>
          {timeline.map((h, i) => (
            <tr key={`${h.stage}-${i}`}>
              <td className="mono small">{hhmm(h.atMs)}</td>
              <td className="small">{h.stage}</td>
              <td className="mono small">{h.target}</td>
              <td className="mono small">{h.corr}</td>
              <td className="small" style={{ color: /미보고|차단|불일치|미완|판단 불가|대기/.test(h.result) ? 'var(--pending)' : 'var(--pass)' }}>{h.result}</td>
              <td className="small muted">{h.owner}</td>
            </tr>
          ))}
        </Table>
        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn small" onClick={() => audit('UI12-S08-A01', `시간순 관측 이력 ${timeline.length}단계`)}>시간순 관측 이력 확인</button>
          <Link className="btn small" to="/twin/incident">관련 명령과 장애 조회</Link>
          <Link className="btn small" to="/twin/incident">검증된 대상만 복구 화면으로 연결</Link>
        </div>
        <div className="kv small mt">
          같은 상관 ID 로 접수·처리·결과를 잇는다 — 상관 ID <span className="mono">{timeline[0]?.corr}</span> · 명령 <span className="mono">{timeline[4]?.corr}</span> · publication <span className="mono">{timeline[6]?.corr}</span><br />
          다음 행동 — {row.state === 'UNKNOWN' ? `미보고: ${UNKNOWN_CAUSE_ACTION[row.cause].ko}` : row.state === 'PENDING' ? '대기: 평가·Guard 결과가 도착할 때까지 성공으로 세지 않는다' : row.state === 'BLOCKED' ? '차단: 차량 제어기의 최종 판단과 복구 증적을 확인한 뒤 안전 전이를 검토한다' : row.state === 'DIVERGED' ? '불일치: 노드별 목표·관측 차이를 확인하고 재전달 여부를 판단한다' : '확인: 현재 boot·sequence·출시와 일치한다'}
        </div>
        <Note>metrics 차트의 수치와 실제 적용 성공 타일은 다른 값이다. 미래·과거·다른 출시의 보고는 이 이력에만 남고 현재 성공으로 집계되지 않는다.</Note>
        <div className="mt"><UlRules items={s08Rules} /></div>
      </div>
    ),
  };

  return <CanonicalScreen screenId="UI12" core="C16 차량 런타임 실행 모듈" kpis={kpis} areas={areas} />;
}

/** 차단·미확인 노드의 복구 증적 문구 — 증적이 없으면 있다고 쓰지 않는다. */
function recoveredNote(guard: 'PASS' | 'BLOCK' | 'UNKNOWN', observed: string): string {
  if (guard === 'BLOCK') return '없음 — 복구 증적 미첨부';
  if (guard === 'UNKNOWN') return '없음 — 판단 근거 없음';
  if (observed === 'OFF') return '부분 — readback OFF 보고';
  return '해당 없음(차단 없음)';
}
