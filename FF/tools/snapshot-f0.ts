// 정적 데모 스냅샷 — 묶음 F0(계정 상태 패널 /admin/iam, 컴플라이언스 룰 상세의 소유자 이관)의 GET 응답.
// tools/snapshot-api.ts main()에서 `await snapshotF0(save)` 한 줄로 부른다(통합 때 연결). 룰 상세(complianceRule {id})는 P1 스냅샷이 이미 찍는다 —
// 소유자 상태·이관 이력은 그 응답 안에 있다. 여기서는 계정 목록(질의 없음)만.
type Save = (name: string, params?: Record<string, string>, query?: Record<string, any>, headers?: Record<string, string>) => Promise<any>;

export async function snapshotF0(save: Save): Promise<{ accounts: number }> {
  const accounts = (await save('accounts')) as { items: unknown[] };
  return { accounts: accounts.items.length };
}
