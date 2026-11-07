// Feature Lifecycle 전이 표 — 통합 상세설계서 v0.81 §2.5 (표 10) 그대로를 데이터로 둔다.
// 평가는 순수 함수: 백엔드(전이 실행)·프론트(스테퍼의 막힌 사유 표시)가 같은 결과를 본다.
import { GATE_META, GATES, LIFECYCLE, ROLE_LABEL, type Asil, type GateId, type GateStatus, type Lifecycle, type Role } from '../enums';
import type { DependencyRow, FeatureVersionRow } from '../schemas/dataset';
import type { RefStatus } from '../schemas/refdb';
import { refLinksBlockApproval } from './refdb/status-policy';
import { gateSatisfied } from './gate-outcome';
import { gateCheckMessage, TRANSITION_CHECK_GATES, transitionCheckFailures, type GateCheck } from './gate-checks';
import { retirementGateBlockers, type IssueItem, type RetirementGateFacts } from './feature-retire';

export interface TransitionRule {
  from: Lifecycle;
  to: Lifecycle;
  /** 최신 판정이 PASS여야 하는 Gate */
  gates: GateId[];
  /** 비어 있으면 안 되는 속성 */
  inputs: (keyof FeatureVersionRow)[];
  /** 실행할 수 있는 역할 (SYSTEM = Registry 자동 전이) */
  roles: Role[];
  auto: boolean;
  reasonRequired: boolean;
  ko: string;
}

const PROPOSAL_INPUTS: (keyof FeatureVersionRow)[] = ['name', 'description', 'requirementIds', 'country', 'vehicleModel', 'trim', 'version', 'ownerId', 'asil'];
/** 구현 연결(Function → SW·Version → 제어기 P/N) — 검증 완료(VERIFIED) 필수. 정의 승인 뒤에는 그 Version을 고칠 수 없어 새 Version으로만 넣는다 */
export const IMPL_INPUTS: (keyof FeatureVersionRow)[] = ['functions', 'swIds', 'swVersions', 'ecuPnos'];

/** 필수 입력 칸의 화면 이름 — 막힌 사유에 영문 필드 키를 쓰지 않는다 */
export const INPUT_LABEL: Partial<Record<keyof FeatureVersionRow, string>> = {
  name: '이름',
  description: '설명',
  requirementIds: '요구사항 ID',
  country: '국가',
  vehicleModel: '차종',
  trim: '트림',
  version: 'Version',
  ownerId: '담당',
  asil: 'ASIL',
  controlPoints: 'Control Point',
  functions: '기능(Function)',
  swIds: 'SW ID',
  swVersions: 'SW Version',
  ecuPnos: '제어기 P/N',
};

/** 이 Version에 비어 있는 구현 연결 칸 */
export const missingImplInputs = (f: Pick<FeatureVersionRow, 'functions' | 'swIds' | 'swVersions' | 'ecuPnos'>) => IMPL_INPUTS.filter((k) => !((f as any)[k]?.length));

export const FEATURE_TRANSITIONS: TransitionRule[] = [
  { from: 'PROPOSED', to: 'APPROVED', gates: ['G1', 'G2', 'G3'], inputs: PROPOSAL_INPUTS, roles: ['FEATURE_APPROVER'], auto: false, reasonRequired: true, ko: '정의 승인' },
  { from: 'APPROVED', to: 'DEVELOPING', gates: [], inputs: ['controlPoints'], roles: ['SYSTEM'], auto: true, reasonRequired: false, ko: '개발 착수 (Control Point 1개 이상)' },
  { from: 'DEVELOPING', to: 'VERIFIED', gates: ['G4', 'G5', 'G6', 'G7'], inputs: IMPL_INPUTS, roles: ['SYSTEM'], auto: true, reasonRequired: false, ko: '검증 완료' },
  { from: 'VERIFIED', to: 'RELEASED', gates: ['G8', 'G9'], inputs: [], roles: ['RELEASE_MANAGER'], auto: false, reasonRequired: true, ko: '출시' },
  { from: 'VERIFIED', to: 'DEVELOPING', gates: [], inputs: [], roles: ['GATE_JUDGE', 'RELEASE_MANAGER'], auto: false, reasonRequired: true, ko: '검증 실패 — 개발로 되돌림' },
  { from: 'RELEASED', to: 'DEPRECATED', gates: [], inputs: [], roles: ['RELEASE_MANAGER'], auto: false, reasonRequired: true, ko: '신규 사용 중단' },
  { from: 'DEPRECATED', to: 'RETIRED', gates: [], inputs: [], roles: ['RELEASE_MANAGER'], auto: false, reasonRequired: true, ko: '종료' },
];

export const LIFECYCLE_RANK: Record<Lifecycle, number> = Object.fromEntries(LIFECYCLE.map((l, i) => [l, i])) as Record<Lifecycle, number>;

export type BlockerCode = 'NO_RULE' | 'GATE_NOT_PASSED' | 'GATE_UNJUDGED' | 'GATE_UNSIGNED' | 'INPUT_MISSING' | 'DEPENDENCY_UNRESOLVED' | 'POLICY_MISSING' | 'RELEASE_SIGNOFF_MISSING' | 'REHARA_OPEN' | 'ROLE' | 'SEPARATION_OF_DUTY' | 'REASON_REQUIRED' | 'REFDB_LINK_BLOCKED' | 'FLAG_CODE_MISSING' | 'GATE_CHECK_FAILED' | 'RETIREMENT_INCOMPLETE' | 'ISSUE_REQUIRED';

export interface Blocker {
  code: BlockerCode;
  message: string;
  ref?: string;
}

export interface TransitionContext {
  /** Gate별 최신 판정 상태 (레코드 없음 = 미판정) */
  latestGates: Partial<Record<GateId, GateStatus>>;
  /** 최신 기록의 Decision Record가 없거나 서명이 맞지 않는 Gate(FFG-LCY-001) — 사유 문구 */
  unsignedGates?: Partial<Record<GateId, string>>;
  /** 이 버전이 원천인 의존관계 */
  dependencies: Pick<DependencyRow, 'dependencyId' | 'targetVersion' | 'verdict'>[];
  /** Control Point 중 정책이 등록된 수 (DEVELOPING→VERIFIED 조건 — 정책 저장소 D01-06) */
  policyCoverage: number;
  actor?: { id: string; role: Role };
  /** 이 버전을 작성한 행위자 (작성자는 자기 요청을 최종 승인할 수 없다) */
  createdBy?: string | null;
  /**
   * Feature Owner의 Release Sign-off(출시 책임 확인 개인 서명) — 현재 G8·G9 판정에 묶인 유효한 서명만.
   * 보고서 6.1 G7(출시·활성화) 승인자는 Feature Owner·Safety Manager다. Safety Manager는 Operations Gate 판정으로,
   * Feature Owner는 이 서명으로 승인한다(사용자 결정 2026-10-18). 없으면(undefined·null) 출시를 막는다.
   */
  releaseSignoff?: { signedBy: string; signedAt: string } | null;
  /**
   * 이 Version에 열린 재-HARA 요청(FFG-LCY-003, FFP-F007) — 영향 검토가 끝나지 않은 변경은 출시로 승격하지 않는다.
   * G8·G9 PASS·서명 뒤에 열린 요청도 출시를 막는다(Gate PASS 차단만으로는 이미 PASS한 판정을 되돌리지 못한다).
   */
  openRehara?: { requestId: string; condition: string; detail?: string }[];
  /**
   * 연결된 기준 행(f.featureRefs)의 지금 Feature DB 상태(30-95 §5.2) — 주면 PROPOSED→APPROVED에서 요청 중(PENDING)·폐기(RETIRED)·없는 행을 막는다.
   * 빠지면(Feature DB 연결 전 호출자) 이 조건을 보지 않는다.
   */
  refStatusOf?: (refId: string) => RefStatus | null | undefined;
  /**
   * 대표 기준 행의 지금 대표 ASIL(30-95 §6.3) — 주면 PROPOSED→APPROVED에서 Feature ASIL과 다를 때
   * 지금 대표 ASIL 기준 사유(asilDeviation from=대표 ASIL, to=Feature ASIL)가 없으면 막는다(등록 뒤 대표 ASIL이 바뀐 경우).
   */
  refAsilRepOf?: (refId: string) => Asil | null | undefined;
  /**
   * Flag 코드 연결 출시 관문(20-97 §3.4, rules/flag-coverage.ts flagReleaseGate) — 주면 RELEASED로 갈 때 코드 연결 없는 Flag를 막는다.
   * 승인된 출시 차단 해제는 호출자가 계산에 넣는다. 빠지면(대사 연결 전 호출자) 이 조건을 보지 않는다.
   */
  flagCodeGate?: { pass: boolean; blockers: { flagKey: string; status: string; message: string }[] } | null;
  /**
   * Gate 자동 검사(rules/gate-checks.ts, FR-REG-005-001·002·004·006·007·020) — 주면 정의 승인(G1·G3)·검증 완료(G4·G5)·출시(G8·G9) 전이에서
   * 그 Gate의 실패한 검사를 막는다. 빠지면(검사 사실을 모으기 전 호출자) 보지 않는다.
   */
  gateChecks?: GateCheck[];
  /** Retired 전이 관문(FR-REG-005-017·018) — 주면 RELEASED·DEPRECATED에서 RETIRED로 갈 때 배포 중 Flag·끝나지 않은 Flag Retirement를 막는다 */
  retirementGate?: RetirementGateFacts;
  /** 검증 이슈 항목(FR-REG-002-013) — 사람이 VERIFIED → DEVELOPING으로 되돌릴 때 1개 이상 */
  issues?: IssueItem[];
  reason?: string;
}

export function ruleFor(from: Lifecycle, to: Lifecycle): TransitionRule | undefined {
  return FEATURE_TRANSITIONS.find((r) => r.from === from && r.to === to);
}

export function nextTransitions(from: Lifecycle): TransitionRule[] {
  return FEATURE_TRANSITIONS.filter((r) => r.from === from);
}

const isEmpty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/** 전이 가능 여부와 막힌 사유 전부를 돌려준다(첫 사유에서 멈추지 않는다 — 화면에서 한 번에 보여 주기 위해). */
export function evaluateTransition(f: FeatureVersionRow, to: Lifecycle, ctx: TransitionContext): { rule?: TransitionRule; blockers: Blocker[] } {
  const rule = ruleFor(f.lifecycle, to);
  if (!rule) return { blockers: [{ code: 'NO_RULE', message: `${f.lifecycle} → ${to} 전이는 정의되어 있지 않습니다.` }] };
  const blockers: Blocker[] = [];

  // @req FR-REG-002-008 FR-REG-002-009
  // 출시(RELEASED 진입)는 9 Gate 전부를 다시 본다. 표 10의 G8·G9만 보면
  // VERIFIED 단계에서 G1~G7을 FAIL로 다시 판정해도 출시가 막히지 않는다(앞 단계 통과는 그 시점의 사실일 뿐).
  const gates = rule.to === 'RELEASED' ? GATES : rule.gates;
  for (const g of gates) {
    const s = ctx.latestGates[g];
    if (!s) blockers.push({ code: 'GATE_UNJUDGED', message: `${g} ${GATE_META[g].name} 미판정`, ref: g });
    // 승인된 N/A(해당 없음)는 통과로 본다(FR-REG-005-008·013 — 사유·승인자 기록)
    else if (!gateSatisfied(s)) blockers.push({ code: 'GATE_NOT_PASSED', message: `${g} ${GATE_META[g].name} ${s}`, ref: g });
    else if (ctx.unsignedGates?.[g]) blockers.push({ code: 'GATE_UNSIGNED', message: `${g} ${GATE_META[g].name} — ${ctx.unsignedGates[g]}`, ref: g });
  }
  for (const k of rule.inputs) if (isEmpty(f[k])) blockers.push({ code: 'INPUT_MISSING', message: `필수 입력 누락: ${INPUT_LABEL[k] ?? String(k)}`, ref: String(k) });

  if (rule.to === 'APPROVED')
    for (const d of ctx.dependencies)
      if (!d.targetVersion) blockers.push({ code: 'DEPENDENCY_UNRESOLVED', message: `${d.dependencyId} 대상 Version 미확정`, ref: d.dependencyId });

  // Feature DB 연결(D-REF-7) — 요청 중 행은 DB 관리자 승인 전, 폐기 행은 다른 행으로 다시 연결해야 정의 승인을 할 수 있다
  if (rule.from === 'PROPOSED' && rule.to === 'APPROVED' && ctx.refStatusOf) {
    const links = f.featureRefs ?? [];
    // 연결이 없는 Feature(연결 도입 전 시드·그 새 Version)는 정의 승인 전에 대표 기준 행을 연결해야 한다(사용자 결정 2026-11-04) — 이미 승인된 버전은 그대로
    if (!links.some((l) => l.role === 'PRIMARY'))
      blockers.push({ code: 'REFDB_LINK_BLOCKED', message: '기준 기능(Feature DB) 연결이 없습니다 — 초안에서 대표 기준 행을 연결하세요.', ref: 'featureRefs' });
    for (const b of refLinksBlockApproval(links, ctx.refStatusOf)) blockers.push({ code: 'REFDB_LINK_BLOCKED', message: b.message, ref: b.refId });
  }

  // 대표 ASIL 다시 확인(§6.3) — 등록 뒤 대표 행의 대표 ASIL이 바뀌었으면 지금 값 기준 사유가 있어야 한다
  const primaryLink = rule.from === 'PROPOSED' && rule.to === 'APPROVED' ? f.featureRefs?.find((l) => l.role === 'PRIMARY') : undefined;
  const rep = primaryLink ? ctx.refAsilRepOf?.(primaryLink.refId) : undefined;
  if (primaryLink && rep && rep !== f.asil) {
    const dev = f.asilDeviation;
    if (!dev || dev.to !== f.asil)
      blockers.push({ code: 'REFDB_LINK_BLOCKED', message: `ASIL ${f.asil}이(가) 대표 기준 행 ${primaryLink.refId}의 대표 ASIL ${rep}과(와) 다른데 사유가 없습니다 — 초안에서 ASIL 차이 사유(${rep} → ${f.asil})를 입력하거나 ASIL을 맞추세요.`, ref: primaryLink.refId });
    else if (dev.from !== rep)
      blockers.push({ code: 'REFDB_LINK_BLOCKED', message: `ASIL 차이 사유가 이전 대표 ASIL ${dev.from} 기준입니다 — 대표 기준 행 ${primaryLink.refId}의 대표 ASIL이 ${rep}(으)로 바뀌었으니 사유(${rep} → ${f.asil})를 다시 입력하세요.`, ref: primaryLink.refId });
  }

  if (rule.from === 'VERIFIED' && rule.to === 'RELEASED' && !ctx.releaseSignoff)
    blockers.push({ code: 'RELEASE_SIGNOFF_MISSING', message: 'Feature Owner의 Release Sign-off(출시 책임 확인 개인 서명)가 없습니다 — G8·G9 PASS 뒤 Feature Owner가 서명합니다.' });

  if (rule.to === 'RELEASED' && ctx.flagCodeGate && !ctx.flagCodeGate.pass)
    for (const b of ctx.flagCodeGate.blockers)
      blockers.push({ code: 'FLAG_CODE_MISSING', message: `Flag ${b.flagKey}: ${b.message}`, ref: b.flagKey });

  if (rule.to === 'RELEASED')
    for (const r of ctx.openRehara ?? [])
      blockers.push({ code: 'REHARA_OPEN', message: `재-HARA 요청 ${r.requestId}(${r.condition})이 열려 있습니다 — 영향 검토(G2 재판정)를 마친 뒤 출시합니다.`, ref: r.requestId });

  // @req FR-REG-005-001 FR-REG-005-002 FR-REG-005-004 FR-REG-005-006 FR-REG-005-007 FR-REG-005-020
  // Gate 자동 검사 — 판정 PASS 뒤에 바뀐 데이터(관계 대상 Lifecycle·Evidence·정책·Flag 결속)도 전이 시점에 다시 본다
  if (TRANSITION_CHECK_GATES[rule.to] && ctx.gateChecks) for (const x of transitionCheckFailures(rule.to, ctx.gateChecks)) blockers.push({ code: 'GATE_CHECK_FAILED', message: gateCheckMessage(x), ref: `${x.gate}:${x.key}` });

  // @req FR-REG-005-017 FR-REG-005-018 — 출시된 적 있는 Version은 Flag Retirement가 끝나야 RETIRED
  if (rule.to === 'RETIRED' && ctx.retirementGate) for (const m of retirementGateBlockers(rule.from, ctx.retirementGate)) blockers.push({ code: 'RETIREMENT_INCOMPLETE', message: m });

  // @req FR-REG-002-013 — 검증 이슈로 되돌릴 때 이슈 항목(구조화)·재작업 사유(전이 사유)
  if (rule.from === 'VERIFIED' && rule.to === 'DEVELOPING' && ctx.actor && !(ctx.issues ?? []).length) blockers.push({ code: 'ISSUE_REQUIRED', message: '식별한 이슈 항목을 1개 이상 입력하세요.' });

  if (rule.from === 'DEVELOPING' && rule.to === 'VERIFIED' && ctx.policyCoverage < f.controlPoints.length)
    blockers.push({ code: 'POLICY_MISSING', message: `Control Point ${f.controlPoints.length}개 중 정책 등록 ${ctx.policyCoverage}개` });

  if (ctx.actor) {
    if (!rule.roles.includes(ctx.actor.role)) blockers.push({ code: 'ROLE', message: `허용 역할이 아닙니다 (${rule.roles.map((r) => ROLE_LABEL[r]).join(' · ')})` }); // 역할 코드 대신 한글 라벨(UX3-08)
    if (!rule.auto && ctx.createdBy && ctx.createdBy === ctx.actor.id)
      blockers.push({ code: 'SEPARATION_OF_DUTY', message: '작성자는 자기 Feature 버전을 승인·출시할 수 없습니다.' });
  }
  if (rule.reasonRequired && ctx.actor && !(ctx.reason ?? '').trim()) blockers.push({ code: 'REASON_REQUIRED', message: '전이 사유를 입력하세요.' });
  return { rule, blockers };
}

/** 자동 전이(APPROVED→DEVELOPING, DEVELOPING→VERIFIED) 중 지금 조건을 만족하는 것 */
export function autoTransition(f: FeatureVersionRow, ctx: TransitionContext): TransitionRule | undefined {
  return nextTransitions(f.lifecycle).find((r) => r.auto && evaluateTransition(f, r.to, { ...ctx, actor: undefined }).blockers.length === 0);
}

/** semver 비교 (숫자 세그먼트) */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

export function bumpVersion(v: string, kind: 'major' | 'minor' | 'patch'): string {
  const [ma, mi, pa] = v.split('.').map(Number);
  return kind === 'major' ? `${ma + 1}.0.0` : kind === 'minor' ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;
}

/** 판정 결과 → 판정 상태 (CONDITIONAL은 '검토 중') */
export function gateStatusOf(result: 'PASS' | 'CONDITIONAL' | 'FAIL'): GateStatus {
  return result === 'CONDITIONAL' ? '검토 중' : result;
}
