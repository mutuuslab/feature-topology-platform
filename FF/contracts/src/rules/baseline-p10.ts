// BOM Baseline 비교·ChangeSet과 출시 후보 통합 스냅샷(P10, D01-01 · FR-REG-004-003·004, FR-REG-005-015).
//  · ChangeSet: 두 Baseline 스냅샷의 차이를 변경 유형(추가·삭제·변경)·변경 영역·변경 항목으로 나눈다. 확정 때마다 직전 Baseline 대비로 남긴다(추가만).
//  · 출시 후보 통합 스냅샷: 출시(VERIFIED→RELEASED) 승인 시점의 Feature·요구·Variant·정책·Test Evidence를 한 문서로, 내용 해시와 함께 남긴다.
import { canonicalJson, snapshotContent, snapshotDiff, type SnapshotContent } from './canonical';
import type { BomItemRow, FeatureVersionRow } from '../schemas/dataset';

export type ChangeType = 'ADDED' | 'REMOVED' | 'MODIFIED';
/** 변경 영역 — Baseline 필드를 업무 영역으로 묶는다 */
export type ChangeArea = 'DEFINITION' | 'REQUIREMENT' | 'SCOPE' | 'IMPLEMENTATION' | 'CONTROL' | 'RELATION' | 'SAFETY' | 'REFERENCE';
export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = { ADDED: '추가', REMOVED: '삭제', MODIFIED: '변경' };
export const CHANGE_AREA_LABEL: Record<ChangeArea, string> = {
  DEFINITION: '정의',
  REQUIREMENT: '요구사항',
  SCOPE: '적용 범위',
  IMPLEMENTATION: '구현 연결',
  CONTROL: '제어점',
  RELATION: '관계',
  SAFETY: '안전',
  REFERENCE: '기준 기능',
};
const AREA_OF: Record<string, ChangeArea> = {
  name: 'DEFINITION',
  description: 'DEFINITION',
  ownerId: 'DEFINITION',
  tags: 'DEFINITION',
  version: 'DEFINITION',
  featureId: 'DEFINITION',
  requirementIds: 'REQUIREMENT',
  refRegulations: 'REQUIREMENT',
  country: 'SCOPE',
  vehicleModel: 'SCOPE',
  trim: 'SCOPE',
  upgVc: 'SCOPE',
  functions: 'IMPLEMENTATION',
  swIds: 'IMPLEMENTATION',
  swVersions: 'IMPLEMENTATION',
  ecuPnos: 'IMPLEMENTATION',
  controlPoints: 'CONTROL',
  dependencyIds: 'RELATION',
  asil: 'SAFETY',
  asilDeviation: 'SAFETY',
  featureRefs: 'REFERENCE',
};
export const changeAreaOf = (field: string): ChangeArea => AREA_OF[field] ?? 'DEFINITION';

export interface ChangeItem {
  type: ChangeType;
  area: ChangeArea;
  field: string;
  /** 목록 필드는 더해지고 빠진 값, 단일 값은 null */
  added: unknown[] | null;
  removed: unknown[] | null;
  before: unknown;
  after: unknown;
}

const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && !v.length);

/** 두 스냅샷의 변경 항목 — 필드 순(snapshotDiff 순서) */
export function changeItems(prev: SnapshotContent | null, next: SnapshotContent): ChangeItem[] {
  return snapshotDiff(prev, next).map((d) => {
    const type: ChangeType = empty(d.before) ? 'ADDED' : empty(d.after) ? 'REMOVED' : 'MODIFIED';
    const list = Array.isArray(d.before) || Array.isArray(d.after);
    const b = (Array.isArray(d.before) ? d.before : []) as unknown[];
    const a = (Array.isArray(d.after) ? d.after : []) as unknown[];
    const key = (v: unknown) => canonicalJson(v);
    return {
      type,
      area: changeAreaOf(d.field),
      field: d.field,
      added: list ? a.filter((x) => !b.some((y) => key(y) === key(x))) : null,
      removed: list ? b.filter((x) => !a.some((y) => key(y) === key(x))) : null,
      before: d.before,
      after: d.after,
    };
  });
}

/** 두 Baseline 스냅샷 비교(FR-REG-004-003) */
export const compareBaselines = (left: BomItemRow | FeatureVersionRow, right: BomItemRow | FeatureVersionRow) => changeItems(snapshotContent(left), snapshotContent(right));

export interface BaselineChangeSet {
  changesetId: string;
  featureId: string;
  fromBaselineId: string | null;
  fromVersion: string | null;
  toBaselineId: string;
  toVersion: string;
  /** 변경 일시 = 확정 일시 */
  at: string;
  by: string;
  items: ChangeItem[];
  summary: { type: Record<ChangeType, number>; areas: ChangeArea[] };
}

export function changeSetSummary(items: ChangeItem[]): BaselineChangeSet['summary'] {
  const type: Record<ChangeType, number> = { ADDED: 0, REMOVED: 0, MODIFIED: 0 };
  for (const i of items) type[i.type]++;
  return { type, areas: [...new Set(items.map((i) => i.area))] };
}

// ── 출시 후보 통합 스냅샷 ─────────────────────────────────────────
export interface ReleaseCandidateContent {
  feature: SnapshotContent;
  baselineId: string | null;
  requirements: { ids: string[]; links: { elementId: string; elementVersion: string | null; sourceSystem: string }[] };
  variant: { country: string; vehicleModel: string; trim: string; upgVc: string[] };
  policies: { policyId: string; revision: number; flagKey: string; controlPoint: string; status: string; contentHash: string }[];
  testEvidence: {
    gates: { gate: string; gateRecordId: string; status: string; evidenceRef: string | null }[];
    tests: { testCaseId: string; required: boolean | null; evidence: { evidenceId: string; result: string; executedAt: string }[] }[];
  };
}

export interface ReleaseCandidateBaseline {
  rcbId: string;
  featureId: string;
  version: string;
  contentHash: string;
  createdAt: string;
  createdBy: string;
  reason: string;
  content: ReleaseCandidateContent;
}

/** 해시 입력 — 내용만(키 정렬 JSON). 해시 계산(sha256)은 서버가 한다 */
export const releaseCandidateCanonical = (c: ReleaseCandidateContent) => canonicalJson(c);
