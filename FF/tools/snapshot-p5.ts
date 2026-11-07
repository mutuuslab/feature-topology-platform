// 정적 데모 스냅샷 — ADS 구성 마감(P5)의 새 GET 경로. tools/snapshot-api.ts main()이 ADS 구성 블록 뒤에서 한 줄로 부른다(통합 때 연결):
//   await snapshotP5(save, { vehicles: vehicles.items, features: all.items, publications: pubs.items });
// 질의 키 순서는 화면과 같게(정적 파일 이름이 이 순서에 의존). 화면이 여는 탭·서랍을 모두 채운다.
type Save = (name: string, params?: Record<string, string>, query?: Record<string, unknown>, headers?: Record<string, string>) => Promise<any>;

export interface SnapshotP5Context {
  vehicles: { vin: string }[];
  /** Feature Version 목록 — 상세의 분류 패널이 지원 종료 연습을 읽는다 */
  features: { featureId: string; version: string }[];
  publications: { publicationId: string; campaignId: string | null }[];
}

export async function snapshotP5(save: Save, ctx: SnapshotP5Context) {
  // 승인 구성 조합 › 발행 후보·복구 결정 — 배포 정책별 발행 미리보기
  const deployed = await save('listPolicies', {}, { status: 'DEPLOYED' });
  for (const p of deployed.items as { policyId: string }[]) await save('publishPreview', { id: p.policyId });
  await save('recoveryDecisions');
  // 전송 캠페인 역조회 — 게시본의 캠페인
  for (const id of new Set(ctx.publications.map((p) => p.campaignId).filter((x): x is string => !!x))) await save('campaign', { id });
  // 출고 실물 구성 대조 — 목록과 VIN별 상세
  const eol = await save('eolMismatches');
  for (const r of eol.items as { vin: string }[]) await save('eolVehicle', { vin: r.vin });
  // OTA 설치 단계 — 현황과 차량별(차량 상세 '구성과 설치'도 읽는다)
  await save('otaInstalls');
  for (const v of ctx.vehicles) await save('vehicleInstalls', { vin: v.vin });
  // 지원 종료·서버 교체 연습 — Feature 상세 분류 패널
  for (const f of ctx.features) await save('supportDrills', { id: f.featureId, ver: f.version });
  // Shadow 실험 봉투
  const exps = await save('experiments');
  for (const e of exps.items as { experimentId: string; type: string }[]) if (e.type === 'SHADOW') await save('shadowEnvelope', { id: e.experimentId });
}
