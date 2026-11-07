// Feature 관계 유형 값 목록(FR-DEP-009-001·002) — 명세 10종. 등록 검증(rules/topology)·그래프 표시·API 목록이 이 표 하나를 읽는다.
// 관계 유형을 더하거나 바꾸면 enums.ts RelationType과 이 표를 함께 고친다(relation-types.test가 같은지 본다).
import type { RelationType } from '../enums';

/** 순환 금지 묶음 — 같은 묶음의 관계로 원천에 되돌아오면 등록을 막는다. REQUIRES는 Version 단위(precheck R12), 나머지는 Feature 단위 */
export type RelationCycleGroup = 'REQUIRES' | 'HIERARCHY' | 'SUBSTITUTE' | 'OVERRIDES' | 'REPLACES';

export interface RelationTypeRule {
  /** 명세 표기(소문자) */
  spec: string;
  label: string;
  /** 대칭 관계 — A–B와 B–A가 같은 관계 */
  symmetric: boolean;
  /** 반대 방향 짝 — parent_of ↔ child_of. 짝이 이미 있으면 같은 관계로 본다 */
  inverse: RelationType | null;
  cycle: RelationCycleGroup | null;
  /** 대상이 원천만큼 진행돼 있어야 PASS(필수 선행) */
  targetMaturity: boolean;
  /** 대상과 함께 쓰여야 하는 관계 — excludes와 같은 두 Feature에 두면 충돌 */
  together: boolean;
  description: string;
}

export const RELATION_TYPES: Record<RelationType, RelationTypeRule> = {
  REQUIRES: { spec: 'requires', label: '필수 의존', symmetric: false, inverse: null, cycle: 'REQUIRES', targetMaturity: true, together: true, description: '원천이 동작하려면 대상이 함께 있어야 한다' },
  EXCLUDES: { spec: 'excludes', label: '상호 배제', symmetric: true, inverse: null, cycle: null, targetMaturity: false, together: false, description: '두 Feature를 같은 차량에서 함께 켜지 않는다' },
  PARENT_OF: { spec: 'parent_of', label: '상위', symmetric: false, inverse: 'CHILD_OF', cycle: 'HIERARCHY', targetMaturity: false, together: false, description: '원천이 대상의 상위 Feature' },
  CHILD_OF: { spec: 'child_of', label: '하위', symmetric: false, inverse: 'PARENT_OF', cycle: 'HIERARCHY', targetMaturity: false, together: false, description: '원천이 대상의 하위 Feature' },
  COMPOSED_OF: { spec: 'composed_of', label: '구성', symmetric: false, inverse: null, cycle: 'HIERARCHY', targetMaturity: true, together: true, description: '원천이 대상을 구성 요소로 포함한다' },
  OVERRIDES: { spec: 'overrides', label: '우선 적용', symmetric: false, inverse: null, cycle: 'OVERRIDES', targetMaturity: false, together: false, description: '원천이 켜지면 대상의 설정보다 앞선다' },
  FALLBACK_TO: { spec: 'fallback_to', label: '대체 전환', symmetric: false, inverse: null, cycle: 'SUBSTITUTE', targetMaturity: true, together: false, description: '원천을 쓸 수 없으면 대상으로 바꾼다' },
  DEGRADES_TO: { spec: 'degrades_to', label: '기능 축소', symmetric: false, inverse: null, cycle: 'SUBSTITUTE', targetMaturity: true, together: false, description: '원천의 조건이 모자라면 축소 기능인 대상으로 내린다' },
  REPLACES: { spec: 'replaces', label: '대체', symmetric: false, inverse: null, cycle: 'REPLACES', targetMaturity: false, together: false, description: '원천이 대상을 대신한다' },
  DUPLICATES: { spec: 'duplicates', label: '중복', symmetric: true, inverse: null, cycle: null, targetMaturity: false, together: false, description: '같은 기능을 두 Feature가 정의 — 하나로 합칠 대상' },
};

export const RELATION_TYPE_LIST = Object.keys(RELATION_TYPES) as RelationType[];

/** 관계 유형 값 목록(API) — 표 순서 그대로 */
export const relationTypeCatalog = () => RELATION_TYPE_LIST.map((type) => ({ type, ...RELATION_TYPES[type] }));

/** 순환 검사용 방향 간선 — child_of는 반대로 읽는다(상위 → 하위) */
export function cycleEdge(d: { type: RelationType; sourceFeatureId: string; targetFeatureId: string }): [string, string] {
  return d.type === 'CHILD_OF' ? [d.targetFeatureId, d.sourceFeatureId] : [d.sourceFeatureId, d.targetFeatureId];
}

/** 간선을 하나 더하면 생기는 순환(Feature 단위) — 없으면 null */
export function cycleWith(edges: [string, string][], next: [string, string]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const [s, t] of edges) (adj.get(s) ?? adj.set(s, []).get(s)!).push(t);
  // next: s → t. t에서 s로 가는 길이 있으면 순환
  const [s, t] = next;
  if (s === t) return [s, t];
  const prev = new Map<string, string>([[t, '']]);
  const queue = [t];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === s) {
      // prev를 거슬러 s → … → t, 뒤집으면 t → … → s. 순환 = s → t → … → s
      const back = [s];
      for (let cur = s; cur !== t; ) (cur = prev.get(cur)!, back.push(cur));
      return [s, ...back.reverse()];
    }
    for (const m of adj.get(n) ?? []) if (!prev.has(m)) (prev.set(m, n), queue.push(m));
  }
  return null;
}

interface PolicyLike {
  policyId: string;
  featureId: string;
  featureVersion: string;
  flagKey: string;
  status: string;
  enabled: boolean;
  stageBasisPoints?: number | null;
  rollout: { mode: 'ALL' | 'PERCENT' | 'NONE' | string; basisPoints: number };
}

/** 지금 차량에 켜질 수 있는 정책 — 배포·켜짐·배포 범위 0% 초과 */
export const liveForVehicles = (p: PolicyLike) => {
  if (p.status !== 'DEPLOYED' || !p.enabled) return false;
  const approved = p.rollout.mode === 'NONE' ? 0 : p.rollout.mode === 'ALL' ? 10000 : p.rollout.basisPoints;
  return (p.stageBasisPoints == null ? approved : Math.min(approved, p.stageBasisPoints)) > 0;
};

/** excludes 두 Feature가 동시에 활성화 대상인지(FR-DEP-009-003 정책 단위) — 양쪽 모두 차량에 켜질 수 있는 정책이 있으면 경고 */
export function concurrentExclusivePolicies<P extends PolicyLike>(policies: P[], sourceFeatureId: string, targetFeatureId: string) {
  const source = policies.filter((p) => p.featureId === sourceFeatureId && liveForVehicles(p));
  const target = policies.filter((p) => p.featureId === targetFeatureId && liveForVehicles(p));
  return { conflict: source.length > 0 && target.length > 0, source, target };
}
