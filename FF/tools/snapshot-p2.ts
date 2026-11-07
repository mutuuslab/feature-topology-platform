// 정적 데모 스냅샷 — 묶음 P2(외부 API 키·명세·버전, Legacy 연계 설정·변환 규칙·메시지 변환, 사용량 정산 전송)의 GET 응답.
// tools/snapshot-api.ts main()에서 `await snapshotP2(save, { contracts })` 한 줄로 부른다(통합 때 연결). 화면이 보내는 질의 모양 그대로:
//  · /integration/connectors?tab=apikeys — apiKeys(질의 없음)
//  · /integration/connectors?tab=apispec — apiVersions(질의 없음). 명세 받기 링크(openapiSpec)는 정적 모드에서 숨긴다
//  · /integration/connectors?tab=settlement — settlementUsage(질의 없음 = 직전 달) + 기간 선택지(직전 달부터 6개월, 화면 recentPeriods와 같은 계산), settlementTransmissions(질의 없음)
//  · /integration/legacy — legacyLinks·legacyMessages·legacyMessageFormats(질의 없음). legacyMappings·legacyOrders·legacyVehicles는 기존 블록이 이미 저장한다
type Save = (name: string, params?: Record<string, string>, query?: Record<string, any>, headers?: Record<string, string>) => Promise<any>;

export interface SnapshotP2Context {
  /** contracts dist(index.js) — 정산 기간 계산을 화면·서버와 같게 쓴다 */
  contracts: { previousPeriod: (now: string) => string };
  /** 기준 시각(기본: 지금) — 시험이 고정한다 */
  now?: string;
}

/** 직전 달부터 6개월 — frontend/src/screens/ext/SettlementTab.tsx recentPeriods와 같다 */
export function settlementPeriods(prev: (now: string) => string, now: string): string[] {
  const out: string[] = [];
  let at = now;
  for (let i = 0; i < 6; i++) {
    const p = prev(at);
    out.push(p);
    at = `${p}-15T00:00:00.000Z`;
  }
  return out;
}

export async function snapshotP2(save: Save, ctx: SnapshotP2Context): Promise<{ keys: number; links: number; periods: number }> {
  const keys = (await save('apiKeys')) as { items: unknown[] };
  await save('apiVersions');
  await save('settlementUsage');
  const periods = settlementPeriods(ctx.contracts.previousPeriod, ctx.now ?? new Date().toISOString());
  for (const period of periods) await save('settlementUsage', {}, { period });
  await save('settlementTransmissions');
  const links = (await save('legacyLinks')) as { items: unknown[] };
  await save('legacyMessages');
  await save('legacyMessageFormats');
  return { keys: keys.items.length, links: links.items.length, periods: periods.length };
}
