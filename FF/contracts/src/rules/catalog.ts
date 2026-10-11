// Feature Catalog 상품 구성 검증·상품 Lifecycle 전이 — 통합 상세설계서 v0.81 §2.7·§2.8 (표 17), §4.
// 순수 함수: 상품 구성 화면의 실시간 검증과 백엔드 승인 시 재검증이 같은 결과를 낸다.
import { BASELINE_ELIGIBLE, type Lifecycle, type Role } from '../enums';
import type { DependencyRow, ProductRow } from '../schemas/dataset';

/** 구성 검증에 필요한 Baseline 요약 (Baseline 스냅샷 + 해당 Feature 버전의 현재 Lifecycle) */
export interface BaselineRef {
  baselineId: string;
  featureId: string;
  version: string;
  name: string;
  lifecycle: Lifecycle;
  country: string;
  vehicleModel: string;
  trim: string;
}

export type CompositionCode =
  | 'BASELINE_UNKNOWN'
  | 'STATE_NOT_ELIGIBLE'
  | 'SCOPE_MISMATCH'
  | 'DUPLICATE_FEATURE'
  | 'REQUIRES_MISSING'
  | 'EXCLUDES_CONFLICT'
  | 'TYPE_COUNT'
  | 'BUNDLE_UNDEFINED'
  | 'VALIDITY_RANGE'
  | 'EMPTY';

export interface CompositionIssue {
  code: CompositionCode;
  severity: 'FAIL' | 'WARN';
  message: string;
  refs: string[];
}

export interface CompositionInput {
  product: Pick<ProductRow, 'country' | 'vehicleModel' | 'trim' | 'type' | 'baselineIds' | 'validFrom' | 'validTo'>;
  baselines: Map<string, BaselineRef> | Record<string, BaselineRef>;
  dependencies: Pick<DependencyRow, 'dependencyId' | 'type' | 'sourceFeatureId' | 'sourceVersion' | 'targetFeatureId' | 'targetVersion'>[];
  /** 이전 상품 Version에 이미 있던 Baseline — DEPRECATED여도 유지는 허용(신규 선택만 금지) */
  carriedOver?: string[];
}

export interface CompositionResult {
  result: 'PASS' | 'FAIL';
  issues: CompositionIssue[];
  features: BaselineRef[];
}

export function validateComposition(input: CompositionInput): CompositionResult {
  const lookup = (id: string): BaselineRef | undefined => (input.baselines instanceof Map ? input.baselines.get(id) : input.baselines[id]);
  const p = input.product;
  const issues: CompositionIssue[] = [];
  const fail = (code: CompositionCode, message: string, refs: string[] = []) => issues.push({ code, severity: 'FAIL', message, refs });
  const carried = new Set(input.carriedOver ?? []);

  if (!p.baselineIds.length) fail('EMPTY', '구성 Baseline이 없습니다.');
  const features: BaselineRef[] = [];
  for (const id of p.baselineIds) {
    const b = lookup(id);
    if (!b) {
      fail('BASELINE_UNKNOWN', `${id}은(는) 확정된 BOM Baseline이 아닙니다.`, [id]);
      continue;
    }
    features.push(b);
    if (!BASELINE_ELIGIBLE.includes(b.lifecycle) && !carried.has(id))
      fail('STATE_NOT_ELIGIBLE', `${b.featureId} ${b.version}은(는) ${b.lifecycle} — 신규 선택할 수 없습니다.`, [id]);
    if (b.country !== p.country || b.vehicleModel !== p.vehicleModel || b.trim !== p.trim)
      fail('SCOPE_MISMATCH', `${b.featureId} 범위 ${b.country}/${b.vehicleModel}/${b.trim} ≠ 상품 ${p.country}/${p.vehicleModel}/${p.trim}`, [id]);
  }

  const byFeature = new Map<string, BaselineRef[]>();
  for (const f of features) byFeature.set(f.featureId, [...(byFeature.get(f.featureId) ?? []), f]);
  for (const [fid, list] of byFeature)
    if (list.length > 1) fail('DUPLICATE_FEATURE', `같은 Feature ${fid}를 두 번 선택했습니다 (${list.map((x) => x.version).join(', ')}).`, list.map((x) => x.baselineId));

  const selected = new Set(features.map((f) => `${f.featureId}@${f.version}`));
  const selectedIds = new Set(features.map((f) => f.featureId));
  for (const d of input.dependencies) {
    if (!selected.has(`${d.sourceFeatureId}@${d.sourceVersion}`)) continue;
    if (d.type === 'REQUIRES') {
      const ok = d.targetVersion ? selected.has(`${d.targetFeatureId}@${d.targetVersion}`) : selectedIds.has(d.targetFeatureId);
      if (!ok) fail('REQUIRES_MISSING', `${d.sourceFeatureId}가 필요로 하는 ${d.targetFeatureId}${d.targetVersion ? ' ' + d.targetVersion : ''}의 Baseline이 상품에 없습니다 (${d.dependencyId}).`, [d.dependencyId]);
    } else if (selectedIds.has(d.targetFeatureId)) {
      fail('EXCLUDES_CONFLICT', `${d.sourceFeatureId}와 ${d.targetFeatureId}는 함께 구성할 수 없습니다 (${d.dependencyId}).`, [d.dependencyId]);
    }
  }

  const n = features.length;
  if (p.type === 'SINGLE' && n !== 1) fail('TYPE_COUNT', `SINGLE 상품은 Feature 1개여야 합니다 (현재 ${n}개).`);
  if (p.type === 'PACKAGE' && n < 2) fail('TYPE_COUNT', `PACKAGE 상품은 Feature 2개 이상이어야 합니다 (현재 ${n}개).`);
  if (p.type === 'BUNDLE') issues.push({ code: 'BUNDLE_UNDEFINED', severity: 'WARN', message: 'BUNDLE 구성 규칙은 추후 정의 — 외부 상품 포함 여부를 수동 확인하세요.', refs: [] });
  if (p.validFrom && p.validTo && p.validFrom > p.validTo) fail('VALIDITY_RANGE', `유효 시작일 ${p.validFrom}이 종료일 ${p.validTo}보다 늦습니다.`);

  return { result: issues.some((i) => i.severity === 'FAIL') ? 'FAIL' : 'PASS', issues, features };
}

// ── 상품 Lifecycle (표 17) ─────────────────────────────────────────────

export type ProductGuard = 'COMPOSITION_PASS' | 'SOME_NOT_RELEASED' | 'ALL_RELEASED' | 'VALIDITY_SET' | 'VALIDITY_ENDED';

export interface ProductTransitionRule {
  from: Lifecycle;
  to: Lifecycle;
  roles: Role[];
  auto: boolean;
  guards: ProductGuard[];
  ko: string;
  /** 구성 승인과 고객 출시 승인은 서로 다른 승인 — 같은 사람이 둘 다 할 수 없다 */
  approval?: 'CONFIG' | 'RELEASE';
}

export const PRODUCT_TRANSITIONS: ProductTransitionRule[] = [
  { from: 'PROPOSED', to: 'APPROVED', roles: ['PRODUCT_APPROVER'], auto: false, guards: ['COMPOSITION_PASS'], ko: '구성 승인', approval: 'CONFIG' },
  { from: 'APPROVED', to: 'DEVELOPING', roles: ['SYSTEM'], auto: true, guards: ['SOME_NOT_RELEASED'], ko: '구성 Feature 출시 대기' },
  { from: 'APPROVED', to: 'VERIFIED', roles: ['PRODUCT_APPROVER'], auto: false, guards: ['COMPOSITION_PASS', 'ALL_RELEASED'], ko: '상품 검증 완료' },
  { from: 'DEVELOPING', to: 'VERIFIED', roles: ['PRODUCT_APPROVER'], auto: false, guards: ['COMPOSITION_PASS', 'ALL_RELEASED'], ko: '상품 검증 완료' },
  { from: 'VERIFIED', to: 'DEVELOPING', roles: ['PRODUCT_APPROVER'], auto: false, guards: [], ko: '검증 실패 — 되돌림' },
  { from: 'VERIFIED', to: 'RELEASED', roles: ['PRODUCT_APPROVER'], auto: false, guards: ['COMPOSITION_PASS', 'ALL_RELEASED', 'VALIDITY_SET'], ko: '고객 출시 승인', approval: 'RELEASE' },
  { from: 'RELEASED', to: 'DEPRECATED', roles: ['PRODUCT_APPROVER'], auto: false, guards: [], ko: '신규 판매 중단 (기존 고객 유지)' },
  { from: 'DEPRECATED', to: 'RETIRED', roles: ['PRODUCT_APPROVER', 'SYSTEM'], auto: false, guards: ['VALIDITY_ENDED'], ko: '종료 (이력 유지)' },
];

export interface ProductGuardContext {
  composition: CompositionResult;
  today: string; // YYYY-MM-DD
  validFrom: string | null;
  validTo: string | null;
}

export function evaluateProductGuards(rule: ProductTransitionRule, ctx: ProductGuardContext): string[] {
  const out: string[] = [];
  const notReleased = ctx.composition.features.filter((f) => f.lifecycle !== 'RELEASED');
  for (const g of rule.guards) {
    if (g === 'COMPOSITION_PASS' && ctx.composition.result !== 'PASS')
      out.push(`구성 검증 FAIL: ${ctx.composition.issues.filter((i) => i.severity === 'FAIL').map((i) => i.message).join(' / ')}`);
    if (g === 'ALL_RELEASED' && notReleased.length) out.push(`아직 RELEASED가 아닌 Feature: ${notReleased.map((f) => `${f.featureId} ${f.version}(${f.lifecycle})`).join(', ')}`);
    if (g === 'SOME_NOT_RELEASED' && !notReleased.length) out.push('모든 Feature가 RELEASED — 개발 대기 불필요');
    if (g === 'VALIDITY_SET' && !(ctx.validFrom && ctx.validTo)) out.push('출시 상품은 유효 시작·종료일이 필요합니다.');
    if (g === 'VALIDITY_ENDED' && !(ctx.validTo && ctx.validTo < ctx.today)) out.push(`유효 종료일(${ctx.validTo ?? '없음'})이 지나야 종료할 수 있습니다.`);
  }
  return out;
}

export function productRuleFor(from: Lifecycle, to: Lifecycle) {
  return PRODUCT_TRANSITIONS.find((r) => r.from === from && r.to === to);
}
