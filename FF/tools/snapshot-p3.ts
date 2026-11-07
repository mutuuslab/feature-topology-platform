// P3 Feature 관계·추적 연결 — 새 GET 경로의 정적 데모 스냅샷. snapshot-api.ts main()의 save로 부른다(통합 때 한 줄: await snapshotP3(save, { features: all.items })).
// 관계 유형 목록, Feature별 추적 연결 요약('추적 연결' 탭), 추적 커버리지(전체·요구 미연결·Evidence 미등록), 유형별 관계 목록, excludes 동시 활성화 검사.
// 변경 영향(impact)은 같은 경로가 차량·정책·OTA를 더 싣는다 — main()의 기존 저장이 그대로 받는다. 출처 확인(traceSourceLookup)은 등록 칸 전용이라 정적 데모(읽기 전용)에 없다.
import { RELATION_TYPE_LIST } from '../contracts/src/rules/relation-types.ts';

export type SnapshotSave = (name: string, params?: Record<string, string>, query?: Record<string, unknown>, headers?: Record<string, string>) => Promise<any>;
export interface SnapshotP3Context {
  /** listFeatures(latestOnly=false) 항목 */
  features: { featureId: string; version: string }[];
}

export async function snapshotP3(save: SnapshotSave, ctx: SnapshotP3Context) {
  await save('relationTypes');
  for (const id of new Set(ctx.features.map((f) => f.featureId))) await save('featureTrace', { id });
  await save('traceCoverage');
  for (const filter of ['noRequirement', 'missingEvidence']) await save('traceCoverage', {}, { filter });
  await save('traceLinks');
  // Topology 관계 표의 유형 선택 — 10종
  const byType = new Map<string, { items: { dependencyId: string }[] }>();
  for (const type of RELATION_TYPE_LIST) byType.set(type, await save('dependencies', {}, { type }));
  for (const d of byType.get('EXCLUDES')?.items ?? []) await save('exclusionCheck', { id: d.dependencyId });
}
