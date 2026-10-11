// Feature Topology — 의존관계 판정과 등록 전 구조 검증 (상세설계서 §2.4 표 8·9).
// 관계는 Feature Version 사이에 맺는다. 원천이 PROPOSED면 '미판정', 대상 Version 미확정은 CONDITIONAL(승인 보류).
import type { DependencyVerdict } from '../enums';
import type { DependencyRow, FeatureVersionRow } from '../schemas/dataset';
import { LIFECYCLE_RANK } from './lifecycle';
import { findRequiresCycles } from './precheck';

/** DEPRECATED/RETIRED 대상도 한때 RELEASED였으므로 선행 단계는 충족한 것으로 본다 */
const rank = (f: FeatureVersionRow) => Math.min(LIFECYCLE_RANK[f.lifecycle], LIFECYCLE_RANK.RELEASED);
const scope = (x: { country: string; vehicleModel: string; trim: string }) => `${x.country}/${x.vehicleModel}/${x.trim}`;

export function judgeDependency(
  d: Pick<DependencyRow, 'type' | 'country' | 'vehicleModel' | 'trim' | 'targetVersion' | 'targetFeatureId'>,
  source: FeatureVersionRow | undefined,
  target: FeatureVersionRow | undefined,
): { verdict: DependencyVerdict; rationale: string } {
  if (!source) return { verdict: 'FAIL', rationale: '원천 Feature Version이 Registry에 없음.' };
  if (!d.targetVersion) return { verdict: 'CONDITIONAL', rationale: `대상 ${d.targetFeatureId} Version 미확정 — 승인 보류.` };
  if (!target) return { verdict: 'FAIL', rationale: `대상 ${d.targetFeatureId} ${d.targetVersion}이(가) Registry에 없음.` };
  if (scope(source) !== scope(d) || scope(target) !== scope(d)) return { verdict: 'FAIL', rationale: `적용 범위 불일치: 원천 ${scope(source)}, 대상 ${scope(target)}, 관계 ${scope(d)}.` };
  if (source.lifecycle === 'PROPOSED') return { verdict: '미판정', rationale: '원천 PROPOSED — 승인 전 관계 판정 대기.' };
  if (d.type === 'REQUIRES' && rank(target) < rank(source))
    return { verdict: 'FAIL', rationale: `대상 ${target.lifecycle}가 원천 ${source.lifecycle}의 필수 선행 단계 미달.` };
  return {
    verdict: 'PASS',
    rationale:
      d.type === 'REQUIRES'
        ? `대상 ${target.featureId} ${target.version} ${target.lifecycle} 확정; 범위 일치 및 원천 ${source.lifecycle}의 필수 선행 단계 충족.`
        : `배타 관계 범위 일치 — 같은 상품·범위에서 동시 구성 금지 (Catalog 구성 검증에서 확인).`,
  };
}

export type NewDependencyIssue = 'SELF_REFERENCE' | 'DUPLICATE_KEY' | 'EXCLUDES_SYMMETRIC_DUPLICATE' | 'REQUIRES_CYCLE' | 'SCOPE_MISMATCH';

/** 등록 전 구조 검증 — 존재·방향·자기참조·중복·범위·REQUIRES 순환·EXCLUDES 대칭 */
export function validateNewDependency(
  existing: DependencyRow[],
  d: Pick<DependencyRow, 'type' | 'sourceFeatureId' | 'sourceVersion' | 'targetFeatureId' | 'targetVersion'>,
  source: FeatureVersionRow,
  target: FeatureVersionRow | undefined,
): { code: NewDependencyIssue; message: string }[] {
  const out: { code: NewDependencyIssue; message: string }[] = [];
  if (d.sourceFeatureId === d.targetFeatureId) out.push({ code: 'SELF_REFERENCE', message: '원천과 대상이 같은 Feature입니다.' });
  const key = (x: typeof d) => `${x.type}|${x.sourceFeatureId}@${x.sourceVersion}|${x.targetFeatureId}@${x.targetVersion ?? '?'}`;
  const dup = existing.find((e) => key(e) === key(d));
  if (dup) out.push({ code: 'DUPLICATE_KEY', message: `${dup.dependencyId}와 같은 관계입니다.` });
  if (d.type === 'EXCLUDES') {
    const sym = existing.find((e) => e.type === 'EXCLUDES' && e.sourceFeatureId === d.targetFeatureId && e.targetFeatureId === d.sourceFeatureId);
    if (sym) out.push({ code: 'EXCLUDES_SYMMETRIC_DUPLICATE', message: `EXCLUDES는 대칭입니다 — ${sym.dependencyId}가 이미 같은 배타 관계를 표현합니다.` });
  }
  if (target && scope(source) !== scope(target)) out.push({ code: 'SCOPE_MISMATCH', message: `원천 ${scope(source)} ≠ 대상 ${scope(target)} — 다른 범위 Feature와는 관계를 맺을 수 없습니다.` });
  if (d.type === 'REQUIRES') {
    const cycles = findRequiresCycles([...existing.filter((e) => e.type === 'REQUIRES'), d as DependencyRow]);
    const mine = cycles.find((c) => c.includes(`${d.sourceFeatureId}@${d.sourceVersion}`));
    if (mine) out.push({ code: 'REQUIRES_CYCLE', message: `순환이 생깁니다: ${mine.join(' → ')}` });
  }
  return out;
}
