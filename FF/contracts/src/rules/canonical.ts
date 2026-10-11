// BOM Baseline 스냅샷의 정규화 — 해시 입력. Lifecycle·적재 메타(_missing)·식별자(baselineId)는 내용이 아니므로 제외.
// (상세설계서: Baseline은 Lifecycle 상태를 제외하고 불변, 해시도 Lifecycle 제외)
import type { BomItemRow, FeatureVersionRow } from '../schemas/dataset';

export const SNAPSHOT_EXCLUDE = ['lifecycle', '_missing', 'baselineId', 'catalogIds', 'gateRecordIds'] as const;

export type SnapshotContent = Omit<FeatureVersionRow, (typeof SNAPSHOT_EXCLUDE)[number]>;

export function snapshotContent(row: FeatureVersionRow | BomItemRow): SnapshotContent {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!(SNAPSHOT_EXCLUDE as readonly string[]).includes(k)) out[k] = v;
  return out as SnapshotContent;
}

/** 키 정렬 JSON — 같은 내용이면 항상 같은 문자열 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(',')}}`;
}

/** 두 스냅샷의 필드별 차이 (Baseline 승인 화면의 diff) */
export function snapshotDiff(prev: SnapshotContent | null, next: SnapshotContent): { field: string; before: unknown; after: unknown }[] {
  const keys = [...new Set([...Object.keys(prev ?? {}), ...Object.keys(next)])].sort();
  return keys
    .filter((k) => canonicalJson((prev as any)?.[k]) !== canonicalJson((next as any)[k]))
    .map((k) => ({ field: k, before: (prev as any)?.[k] ?? null, after: (next as any)[k] ?? null }));
}
