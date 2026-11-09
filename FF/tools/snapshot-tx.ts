// 정적 데모 스냅샷 — 분류 계층 L0~L5·적용 지역 코드·브랜드별 정책(TX)의 새 GET 경로. tools/snapshot-api.ts main()이 묶음 함수들 뒤에서 한 줄로 부른다(통합 때 연결):
//   await snapshotTx(save, { features: all.items, policies: policies.items });
// Browser-local editing derives filtered reads from these complete source snapshots.
type Save = (name: string, params?: Record<string, string>, query?: Record<string, unknown>, headers?: Record<string, string>) => Promise<any>;

export interface SnapshotTxContext {
  /** Feature Version 목록 — 상세 '분류 경로' 탭은 Feature ID로 읽는다 */
  features: { featureId: string }[];
  policies: { policyId: string }[];
}

const LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
const REGION_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'G'];
const BRANDS = ['HYUNDAI', 'KIA', 'GENESIS'];

export async function snapshotTx(save: Save, ctx: SnapshotTxContext) {
  // 분류 계층 — 개요·수준별 분류·트리
  await save('taxonomyLevels');
  for (const level of LEVELS) await save('taxonomyLevel', { level });
  await save('taxonomyNodes');
  // The query preflight also reads the exact level URL before the browser-local reader derives its filtered view.
  for (const level of LEVELS) await save('taxonomyNodes', {}, { level });
  // Feature 상세 '분류 경로'
  for (const id of new Set(ctx.features.map((f) => f.featureId))) await save('featureTaxonomy', { id });
  // 적용 지역 코드 — 대응 표와 룰 등록 서랍의 코드별 후보(코드 하나씩 읽는다)
  await save('regionCodes');
  for (const codes of REGION_CODES) await save('regionVariantCandidates', {}, { codes });
  // 브랜드·권역별 정책
  await save('brands');
  await save('globalScopes');
  for (const policy of ctx.policies) await save('policyGlobalScope', { id: policy.policyId });
  for (const brand of BRANDS) await save('brandPolicies', { brand });
}
