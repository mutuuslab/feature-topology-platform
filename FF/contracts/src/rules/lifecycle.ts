// Feature Lifecycle 전이 표 — 통합 상세설계서 v0.81 §2.5 (표 10) 그대로를 데이터로 둔다.
// 평가는 순수 함수: 백엔드(전이 실행)·프론트(스테퍼의 막힌 사유 표시)가 같은 결과를 본다.
import { GATE_META, LIFECYCLE, ROLE_LABEL, type GateId, type GateStatus, type Lifecycle, type Role } from '../enums';
import type { DependencyRow, FeatureVersionRow } from '../schemas/dataset';

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
const IMPL_INPUTS: (keyof FeatureVersionRow)[] = ['functions', 'swIds', 'swVersions', 'ecuPnos'];

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

export type BlockerCode = 'NO_RULE' | 'GATE_NOT_PASSED' | 'GATE_UNJUDGED' | 'GATE_UNSIGNED' | 'INPUT_MISSING' | 'DEPENDENCY_UNRESOLVED' | 'POLICY_MISSING' | 'RELEASE_SIGNOFF_MISSING' | 'ROLE' | 'SEPARATION_OF_DUTY' | 'REASON_REQUIRED';

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

  for (const g of rule.gates) {
    const s = ctx.latestGates[g];
    if (!s) blockers.push({ code: 'GATE_UNJUDGED', message: `${g} ${GATE_META[g].name} 미판정`, ref: g });
    else if (s !== 'PASS') blockers.push({ code: 'GATE_NOT_PASSED', message: `${g} ${GATE_META[g].name} ${s}`, ref: g });
    else if (ctx.unsignedGates?.[g]) blockers.push({ code: 'GATE_UNSIGNED', message: `${g} ${GATE_META[g].name} — ${ctx.unsignedGates[g]}`, ref: g });
  }
  for (const k of rule.inputs) if (isEmpty(f[k])) blockers.push({ code: 'INPUT_MISSING', message: `필수 입력 누락: ${String(k)}`, ref: String(k) });

  if (rule.to === 'APPROVED')
    for (const d of ctx.dependencies)
      if (!d.targetVersion) blockers.push({ code: 'DEPENDENCY_UNRESOLVED', message: `${d.dependencyId} 대상 Version 미확정`, ref: d.dependencyId });

  if (rule.from === 'VERIFIED' && rule.to === 'RELEASED' && !ctx.releaseSignoff)
    blockers.push({ code: 'RELEASE_SIGNOFF_MISSING', message: 'Feature Owner의 Release Sign-off(출시 책임 확인 개인 서명)가 없습니다 — G8·G9 PASS 뒤 Feature Owner가 서명합니다.' });

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
