// P11a 긴급 차단·해제·사건 범위 — 새 GET 경로의 정적 데모 스냅샷. snapshot-api.ts main()의 save로 부른다(한 줄: await snapshotP11a(save, { kills: kills.items })).
// 차단 요청 접수함(검토 대기·전체), 비활성화 조건 확인 기록, 차단마다 관련 담당자·현재 차단 범위·사건별 종료 차단·영향 차량 산정.
// 차단 요청 폼의 범위 칸은 미리보기 차량 속성으로 화면이 거른다 — 별도 스냅샷이 필요 없다.
export type SnapshotSave = (name: string, params?: Record<string, string>, query?: Record<string, unknown>, headers?: Record<string, string>) => Promise<any>;
export interface SnapshotP11aContext {
  /** killRequests 항목 */
  kills: { killId: string; featureId: string; incidentId?: string | null; command?: unknown }[];
}

export async function snapshotP11a(save: SnapshotSave, ctx: SnapshotP11aContext) {
  await save('killIntakes');
  await save('killIntakes', {}, { status: 'RECEIVED' });
  await save('deactivationChecks');
  for (const featureId of new Set(ctx.kills.map((k) => k.featureId))) {
    await save('killBlockedScope', {}, { featureId });
    await save('terminationInhibits', {}, { featureId });
  }
  for (const k of ctx.kills) {
    await save('killParties', { id: k.killId });
    // 발행된 차단만 사건 산정이 있다
    if (k.command) await save('impactSet', { id: k.incidentId ?? k.killId });
  }
}
