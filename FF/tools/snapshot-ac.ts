// 정적 데모 스냅샷 — AC(승인 조합 승인·보안 최소 버전 표·권한 범위)의 새 GET 경로. tools/snapshot-api.ts main()이 한 줄로 부른다(통합 때 연결):
//   await snapshotAc(save);
// 승인 구성 조합 화면의 '보안 최소 버전 표' 탭·등록 서랍, 권한 화면의 '권한 범위' 패널이 읽는다.
type Save = (name: string, params?: Record<string, string>, query?: Record<string, unknown>, headers?: Record<string, string>) => Promise<any>;

export async function snapshotAc(save: Save) {
  await save('securityMins');
  await save('roleScopes');
}
