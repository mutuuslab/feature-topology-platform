// 속성 변경 → 재판정 Gate (상세설계서 표 7). Tag는 재판정 없음, Control Point는 DEVELOPING 이후에만 G4.
import { GATES, type GateId, type Lifecycle } from '../enums';
import type { FeatureVersionRow } from '../schemas/dataset';
import { LIFECYCLE_RANK } from './lifecycle';

export const REJUDGE_MAP: Partial<Record<keyof FeatureVersionRow, GateId[]>> = {
  name: ['G1'],
  description: ['G1'],
  ownerId: ['G1'],
  requirementIds: ['G2'],
  upgVc: ['G3'],
  asil: ['G7'],
  functions: ['G6'],
  swIds: ['G5'],
  swVersions: ['G5'],
  ecuPnos: ['G5'],
  controlPoints: ['G4'],
  dependencyIds: ['G1', 'G3'],
  tags: [],
};

/** 국가·차종·트림이 바뀌면 새 Feature ID가 필요하다 (같은 ID의 새 버전이 아님) */
export const SCOPE_KEYS: (keyof FeatureVersionRow)[] = ['country', 'vehicleModel', 'trim'];

/** 버전 생성 시 바꿀 수 있는 속성 */
export const VERSIONABLE_KEYS = Object.keys(REJUDGE_MAP) as (keyof FeatureVersionRow)[];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function changedKeys(before: FeatureVersionRow, after: Partial<FeatureVersionRow>): (keyof FeatureVersionRow)[] {
  return (Object.keys(after) as (keyof FeatureVersionRow)[]).filter((k) => k in REJUDGE_MAP || SCOPE_KEYS.includes(k)).filter((k) => !same(before[k], after[k]));
}

/** 변경된 속성으로 다시 판정해야 하는 Gate (오름차순, 중복 제거) */
export function gatesToRejudge(changed: (keyof FeatureVersionRow)[], lifecycle: Lifecycle): GateId[] {
  const set = new Set<GateId>();
  for (const k of changed) {
    if (k === 'controlPoints' && LIFECYCLE_RANK[lifecycle] < LIFECYCLE_RANK.DEVELOPING) continue;
    for (const g of REJUDGE_MAP[k] ?? []) set.add(g);
  }
  return GATES.filter((g) => set.has(g));
}
