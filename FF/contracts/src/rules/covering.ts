// 조합 시험 계획 (D06-03, 보고서 v1.1 FFG-TST-003) — 허용 조합은 Topology의 의존(REQUIRES)·충돌(EXCLUDES)로 정의하고,
// 안전 관련 Flag(F2 이상)가 둘 이상 상호작용하면 3-way covering array로 시험한다. 허용되지 않는 조합은 부정 시험으로 거부를 확인한다.
// 순수 함수: 화면의 시험 계획과 백엔드 API가 같은 결과를 낸다. Flag 수준은 ON/OFF 두 값(Feature 활성 여부).
import type { DependencyRow } from '../schemas/dataset';

type Dep = Pick<DependencyRow, 'dependencyId' | 'type' | 'sourceFeatureId' | 'targetFeatureId'>;

/** 한 번에 다룰 수 있는 상호작용 Flag 상한 — 후보 행을 모두 만든다(2^n) */
export const COVERING_MAX_FACTORS = 14;

/** 이 Feature와 의존·충돌로 이어진 Feature 집합(연결 요소) — 상호작용 범위 */
export function interactionGroup(featureId: string, deps: Dep[]): string[] {
  const seen = new Set([featureId]);
  const queue = [featureId];
  while (queue.length) {
    const f = queue.shift()!;
    for (const d of deps) {
      const other = d.sourceFeatureId === f ? d.targetFeatureId : d.targetFeatureId === f ? d.sourceFeatureId : null;
      if (other && !seen.has(other)) (seen.add(other), queue.push(other));
    }
  }
  return [...seen].sort();
}

export interface CombinationViolation {
  code: 'REQUIRES_MISSING' | 'EXCLUDES_CONFLICT';
  dependencyId: string;
  message: string;
}

/** 켠 Feature 집합이 Topology를 어기는가 — 상품 구성 검증(catalog validateComposition)과 같은 규칙의 Feature 수준 판정 */
export function combinationViolations(on: Iterable<string>, deps: Dep[]): CombinationViolation[] {
  const set = new Set(on);
  const out: CombinationViolation[] = [];
  for (const d of deps) {
    if (!set.has(d.sourceFeatureId)) continue;
    if (d.type === 'REQUIRES' && !set.has(d.targetFeatureId))
      out.push({ code: 'REQUIRES_MISSING', dependencyId: d.dependencyId, message: `${d.sourceFeatureId}는 ${d.targetFeatureId}가 함께 켜져 있어야 합니다` });
    if (d.type === 'EXCLUDES' && set.has(d.targetFeatureId))
      out.push({ code: 'EXCLUDES_CONFLICT', dependencyId: d.dependencyId, message: `${d.sourceFeatureId}와 ${d.targetFeatureId}는 함께 켤 수 없습니다` });
  }
  return out;
}

const subsets = (n: number, t: number): number[][] => {
  const out: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === t) return void out.push(acc);
    for (let i = start; i < n; i++) pick(i + 1, [...acc, i]);
  };
  pick(0, []);
  return out;
};

export interface CoveringArray {
  factors: string[];
  strength: number;
  /** 시험 행 — factors 순서의 ON(true)/OFF(false) */
  rows: boolean[][];
  /** t개 Flag × 값 조합 중 허용 행으로 만들 수 있는 것 */
  tuples: number;
  covered: number;
  /** 제약 때문에 어떤 허용 행에도 나올 수 없는 조합 수(부정 시험 대상) */
  infeasible: number;
}

/**
 * 탐욕적 t-way covering array — 허용 행(allowed)만 쓰고, 매 단계 아직 덮지 못한 t-조합을 가장 많이 덮는 행을 고른다(AETG 계열).
 * 허용 행으로 만들 수 없는 조합은 덮을 수 없으므로 세지 않는다(infeasible). 인자 수가 t보다 작으면 전수(full factorial).
 */
export function coveringArray(factors: string[], strength: number, allowed: (row: boolean[]) => boolean): CoveringArray {
  const n = factors.length;
  if (n > COVERING_MAX_FACTORS) throw new Error(`상호작용 Flag ${n}개 — 한 계획은 ${COVERING_MAX_FACTORS}개까지입니다(범위를 나누세요)`);
  const t = Math.min(strength, n);
  const candidates: boolean[][] = [];
  for (let m = 0; m < 1 << n; m++) {
    const row = factors.map((_, i) => !!(m & (1 << i)));
    if (allowed(row)) candidates.push(row);
  }
  const key = (idx: number[], row: boolean[]) => idx.map((i) => `${i}${row[i] ? '+' : '-'}`).join('');
  const sets = subsets(n, t);
  const all = new Set<string>();
  for (const idx of sets) for (let v = 0; v < 1 << t; v++) all.add(idx.map((i, j) => `${i}${v & (1 << j) ? '+' : '-'}`).join(''));
  const feasible = new Set<string>();
  for (const row of candidates) for (const idx of sets) feasible.add(key(idx, row));
  const uncovered = new Set(feasible);
  const rows: boolean[][] = [];
  while (uncovered.size) {
    let best: boolean[] | null = null;
    let gain = 0;
    for (const row of candidates) {
      const g = sets.reduce((s, idx) => s + (uncovered.has(key(idx, row)) ? 1 : 0), 0);
      if (g > gain) (gain = g), (best = row);
    }
    if (!best) break;
    rows.push(best);
    for (const idx of sets) uncovered.delete(key(idx, best));
  }
  return { factors, strength: t, rows, tuples: feasible.size, covered: feasible.size - uncovered.size, infeasible: all.size - feasible.size };
}

export interface CombinationPlan {
  featureId: string;
  /** 상호작용 범위(Topology 연결 요소) */
  group: string[];
  /** 그 중 안전 관련 Flag(F2 이상, 분류 없음은 안전 관련으로 본다) */
  safetyFlags: string[];
  /** 실제로 만든 강도(인자 수가 요구보다 적으면 인자 수 = 전수) */
  strength: number;
  /** 규칙이 요구한 강도 — 안전 관련 Flag 2개 이상 상호작용이면 3 */
  requestedStrength: number;
  /** 왜 이 강도인가 */
  basis: string;
  array: CoveringArray;
  /** 허용되지 않는 최소 조합 — 각 의존·충돌마다 하나, 거부를 확인한다 */
  negatives: { on: string[]; off: string[]; expect: CombinationViolation['code']; dependencyId: string }[];
}

/**
 * Feature 하나의 조합 시험 계획.
 * @rule FFG-TST-003 — 허용 조합 = Topology REQUIRES·EXCLUDES, 안전 관련 Flag 2개 이상 상호작용이면 3-way, 금지 조합은 부정 시험. 조합별 vECU 실행은 다기능 차량 런타임이 생기면(현재 FEAT-00022 단독)
 */
export function combinationPlan(featureId: string, deps: Dep[], fClassOf: (featureId: string) => string | null): CombinationPlan {
  const group = interactionGroup(featureId, deps);
  const inGroup = deps.filter((d) => group.includes(d.sourceFeatureId) && group.includes(d.targetFeatureId));
  const safetyFlags = group.filter((f) => {
    const c = fClassOf(f);
    return c == null || c >= 'F2';
  });
  const strength = safetyFlags.length >= 2 ? 3 : 2;
  const basis =
    safetyFlags.length >= 2
      ? `안전 관련 Flag ${safetyFlags.length}개가 상호작용 — 3-way 요구${group.length <= 3 ? ` (Flag ${group.length}개라 전수)` : ''}`
      : `안전 관련 Flag ${safetyFlags.length}개 — 2-way${group.length <= 2 ? '(전수)' : ''}`;
  const array = coveringArray(group, strength, (row) => combinationViolations(group.filter((_, i) => row[i]), inGroup).length === 0);
  const negatives = inGroup.map((d) =>
    d.type === 'REQUIRES'
      ? { on: [d.sourceFeatureId], off: [d.targetFeatureId], expect: 'REQUIRES_MISSING' as const, dependencyId: d.dependencyId }
      : { on: [d.sourceFeatureId, d.targetFeatureId], off: [], expect: 'EXCLUDES_CONFLICT' as const, dependencyId: d.dependencyId },
  );
  return { featureId, group, safetyFlags, strength: array.strength, requestedStrength: strength, basis, array, negatives };
}
