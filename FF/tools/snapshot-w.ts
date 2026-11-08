// 정적 데모 스냅샷 — 차량 상태 보고 2.1(W)의 새 GET 경로. tools/snapshot-api.ts main()이 차량 블록 뒤에서 한 줄로 부른다(통합 때 연결):
//   await snapshotW(save, { vehicles: vehicles.items });
// 재연결 대조(서버 의도 vs 차량 보고 2.1)는 차량마다 하나.
type Save = (name: string, params?: Record<string, string>, query?: Record<string, unknown>, headers?: Record<string, string>) => Promise<any>;

export interface SnapshotWContext {
  vehicles: { vin: string }[];
}

export async function snapshotW(save: Save, ctx: SnapshotWContext) {
  for (const v of ctx.vehicles) await save('vehicleReconcile', { vin: v.vin });
}
