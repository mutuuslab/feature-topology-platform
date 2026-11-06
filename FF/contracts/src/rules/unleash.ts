// IF-04 Policy Tool (Unleash OSS 8.3.1) 연계 계획 — P0 개정 v1.0 기준. FP가 승인·서명·감사의 원천이고 Unleash는 읽기·평가용 사본(UL-LIVE).
// 배포(DEPLOYED, 서명 게시된) 정책만 Unleash 정의로 내보낸다(UL-OSS: 미서명 정의 배포 금지). hfp-feature-lifecycle js/unleash.js plan()의 TS 이식:
//   flag = 정책 flagKey(care_00022_param), 전략 = flexibleRollout(정책 strategies 하나당 하나, Unleash가 OR), 제약 = 적용 범위 + 사용 권한 + 대상 규칙,
//   부분 롤아웃은 FP-COHORT-1 서명 코호트 목록(vehicleKey IN …)으로 표현하고 Unleash rollout은 0/100만 쓴다(BD-09).
//   표현할 수 없는 관계(EXCLUDES)는 BLOCKED. REQUIRES는 대상 Feature에 배포 flag가 있을 때만 Unleash 의존으로 —
//   flag 없는 대상(차량에 기본 탑재된 기반 기능 등)은 FP Topology·Catalog 검증이 보장하므로 참고(notes)로만 남긴다.
import type { Constraint } from '../flags/p0';
import type { Policy } from '../schemas/policy';
import { effectiveBasisPoints } from '../flags/evaluate';

export const UNLEASH_PROJECT = 'default';
export const UNLEASH_ENVIRONMENT = 'development';
export const UNLEASH_APP = 'FF-PLATFORM';

export interface UnleashConstraint {
  contextName: string;
  operator: Constraint['operator'];
  values?: string[];
  value?: string;
  inverted: boolean;
  caseInsensitive: boolean;
}
export interface UnleashStrategy {
  name: 'flexibleRollout';
  title: string;
  disabled: false;
  parameters: { groupId: string; rollout: string; stickiness: 'default' };
  constraints: UnleashConstraint[];
  variants: [];
  segments: [];
}
export interface UnleashPlan {
  flagName: string;
  project: string;
  environment: string;
  description: string;
  enabled: boolean;
  strategies: UnleashStrategy[];
  dependencies: string[];
  tags: { type: string; value: string }[];
  blockers: string[];
  notes: string[];
  ready: boolean;
}

/** 단일 값 연산자(NUM·SEMVER·DATE)는 Unleash에서 value, 나머지는 values */
const SINGLE = /^(NUM_|SEMVER_|DATE_)/;
export function toUnleashConstraint(c: Constraint): UnleashConstraint {
  const base = { contextName: c.contextName, operator: c.operator, inverted: !!c.inverted, caseInsensitive: !!c.caseInsensitive };
  return SINGLE.test(c.operator) ? { ...base, value: c.values[0] } : { ...base, values: [...c.values] };
}

/** Unleash 태그 값 규칙(ASCII, 50자 이하, 앞뒤 공백 없음) — 어기는 값은 태그로 보내지 않는다(hfp와 같다) */
const tagOk = (v: string) => /^[\x20-\x7E]{1,50}$/.test(v) && v.trim() === v;

export interface PlanInput {
  policy: Policy;
  scope: { country: string; vehicleModel: string; trim: string };
  /** REQUIRES 대상 Feature마다 그 Feature의 배포 flag (없으면 빈 목록 → Unleash 의존 없이 참고) */
  requires: { featureId: string; flagKeys: string[] }[];
  /** EXCLUDES 관계 상대 Feature — Unleash로 표현할 수 없다 */
  excludes: string[];
  /** COHORT 정책이면 FP-COHORT-1 소속 차량(등록 Fleet 기준, 효과 비율) */
  cohortMembers: string[] | null;
}

/** Unleash에 서명 코호트 목록으로 내보낼 부분 롤아웃인가 — 코호트 롤아웃이거나, 단계 효력이 전체보다 좁다 */
export const unleashPartial = (p: Pick<Policy, 'rollout' | 'stageBasisPoints'>) => p.rollout.mode === 'COHORT' || (p.rollout.mode !== 'NONE' && effectiveBasisPoints(p) < 10000);

export function planUnleash(i: PlanInput): UnleashPlan {
  const p = i.policy;
  const blockers: string[] = [];
  const notes: string[] = [];
  if (p.status !== 'DEPLOYED') blockers.push(`배포(DEPLOYED)된 정책만 내보낼 수 있습니다 — 현재 ${p.status} (UL-OSS: 미서명 정의 배포 금지)`);
  for (const f of i.excludes) blockers.push(`EXCLUDES ${f}: Unleash 의존 관계로 표현할 수 없습니다`);
  const dependencies: string[] = [];
  for (const r of i.requires) {
    if (!r.flagKeys.length) notes.push(`REQUIRES ${r.featureId}: 대상에 배포 flag가 없어 Unleash 의존 없이 FP Topology가 보장`);
    else dependencies.push(...r.flagKeys);
  }
  const applicability: UnleashConstraint[] = [
    { contextName: 'country', operator: 'IN', values: [i.scope.country], inverted: false, caseInsensitive: false },
    { contextName: 'vehicleModel', operator: 'IN', values: [i.scope.vehicleModel], inverted: false, caseInsensitive: false },
    { contextName: 'vehicleTrim', operator: 'IN', values: [i.scope.trim], inverted: false, caseInsensitive: false },
  ];
  if (p.entitlementCatalogId) applicability.push({ contextName: 'trialSessionValid', operator: 'IN', values: ['true'], inverted: false, caseInsensitive: false });
  // 부분 롤아웃 = 서명 코호트 목록. 목록이 비면(0%) 전략이 아무 차량도 고르지 않도록 env를 끈다.
  // 단계적 배포(Canary 등, stageBasisPoints)도 부분 롤아웃이다 — 승인 범위가 전체(ALL)여도 지금 효력 범위의 차량만 고른다(FFG-LCY-009).
  // 단계를 빼면 Unleash는 전체 ON, 플랫폼은 단계 밖 OFF(COHORT_MISS)로 갈렸다(2026-11-06)
  let enabled = p.enabled && p.rollout.mode !== 'NONE';
  if (unleashPartial(p)) {
    const members = i.cohortMembers ?? [];
    if (!members.length) enabled = false;
    else applicability.push({ contextName: 'vehicleKey', operator: 'IN', values: [...members].sort(), inverted: false, caseInsensitive: false });
  }
  const strategySets = p.strategies.length ? p.strategies.map((s) => ({ title: s.name, constraints: s.constraints.map(toUnleashConstraint) })) : [{ title: '전체', constraints: [] as UnleashConstraint[] }];
  const strategies: UnleashStrategy[] = strategySets.map((s) => ({
    name: 'flexibleRollout',
    title: `${p.policyId} ${s.title}`,
    disabled: false,
    parameters: { groupId: p.flagKey, rollout: '100', stickiness: 'default' },
    constraints: [...applicability, ...s.constraints],
    variants: [],
    segments: [],
  }));
  const tags = [
    { type: 'fp-source', value: UNLEASH_APP },
    { type: 'fp-policy', value: `${p.policyId}@r${p.revision}` },
    { type: 'fp-digest', value: p.contentHash.replace(/^sha256:/, '').slice(0, 10) },
    { type: 'fp-feature', value: `${p.featureId}@${p.featureVersion}` },
  ].filter((t) => tagOk(t.value));
  return {
    flagName: p.flagKey,
    project: UNLEASH_PROJECT,
    environment: UNLEASH_ENVIRONMENT,
    description: `${p.featureId} ${p.featureVersion} · ${p.controlPoint} · ${p.description}`.slice(0, 200),
    enabled,
    strategies,
    dependencies: [...new Set(dependencies)],
    tags,
    blockers,
    notes,
    ready: !blockers.length,
  };
}

/** 차량 → Unleash 평가 문맥 (playground/advanced). userId = vehicleKey = VIN */
export function unleashContext(v: { vin: string; country: string; vehicleModel: string; trim: string }, trialSessionValid: boolean | null) {
  return {
    appName: UNLEASH_APP,
    environment: UNLEASH_ENVIRONMENT,
    userId: v.vin,
    properties: {
      vehicleKey: v.vin,
      country: v.country,
      vehicleModel: v.vehicleModel,
      vehicleTrim: v.trim,
      ...(trialSessionValid === null ? {} : { trialSessionValid: String(trialSessionValid) }),
    },
  };
}

/** 서버(Unleash)에 있는 정의와 계획의 차이 — 다른 도구에서 손으로 바꾼 흔적(UL-OSS: FP가 원천) */
export function unleashDrift(plan: UnleashPlan, server: { enabled: boolean | null; strategies: any[]; tags: { type: string; value: string }[]; dependencies?: any[]; variants?: any[] } | null): string[] {
  if (!server) return ['Unleash에 flag가 없습니다'];
  const out: string[] = [];
  // Compare every evaluation-relevant field. Names, case sensitivity, disabled state, segments,
  // dependencies and variants must not escape drift detection just because rollout remains 100.
  const normalize = (v: any): any => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, normalize(v[k])])) : v;
  const key = (v: unknown) => JSON.stringify(normalize(v));
  const strategy = (s: any) => key({ name: s.name, disabled: !!s.disabled, parameters: s.parameters ?? {}, constraints: (s.constraints ?? []).map((c: any) => ({ contextName: c.contextName, operator: c.operator, inverted: !!c.inverted, caseInsensitive: !!c.caseInsensitive, ...(c.values ? { values: [...c.values].sort() } : { value: c.value }) })).map(key).sort(), variants: s.variants ?? [], segments: [...(s.segments ?? [])].sort() });
  const want = plan.strategies.map(strategy).sort();
  const have = server.strategies.map(strategy).sort();
  if (key(want) !== key(have)) out.push(`전략·제약이 다릅니다 (계획 ${want.length}개 / 서버 ${have.length}개)`);
  if (server.enabled !== plan.enabled) out.push(`환경 ${plan.environment} 활성 상태가 다릅니다 (계획 ${plan.enabled ? 'on' : 'off'} / 서버 ${server.enabled ? 'on' : 'off'})`);
  if (server.dependencies !== undefined && key(server.dependencies.map((d) => ({ feature: d.feature, enabled: d.enabled ?? true, variants: d.variants ?? [] })).map(key).sort()) !== key(plan.dependencies.map((feature) => key({ feature, enabled: true, variants: [] })).sort())) out.push('의존 관계가 다릅니다');
  if (server.variants?.length) out.push('계획에 없는 variant가 있습니다');
  for (const t of plan.tags) if (!server.tags.some((x) => x.type === t.type && x.value === t.value)) out.push(`태그 ${t.type}=${t.value} 없음`);
  return out;
}
