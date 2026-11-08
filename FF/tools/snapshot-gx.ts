// 정적 데모 스냅샷 — 묶음 GX(예외 승인 /verify/exceptions, 정책 상세 '출시·예외' 패널)의 GET 응답.
// tools/snapshot-api.ts main()에서 정책 목록을 읽은 뒤 `await snapshotGx(save, { policies: policies.items })` 한 줄로 부른다(통합 때 연결). 화면이 보내는 질의 모양 그대로:
//  · exceptionPolicies(질의 없음 — 화면이 상태로 걸러 보인다), 예외마다 exceptionPolicy {id}
//  · 승인·배포 중 정책마다 policyReleaseGate {id}와 exceptionPolicies { featureId, featureVersion, active: 'true' }(ExceptionPanel 질의 키 순서)
type Save = (name: string, params?: Record<string, string>, query?: Record<string, any>, headers?: Record<string, string>) => Promise<any>;

export interface SnapshotGxContext {
  policies: { policyId: string; featureId: string; featureVersion: string; status: string }[];
}

export async function snapshotGx(save: Save, ctx: SnapshotGxContext): Promise<{ exceptions: number; panels: number }> {
  const list = (await save('exceptionPolicies')) as { items: { exceptionId: string }[] };
  for (const e of list.items) await save('exceptionPolicy', { id: e.exceptionId });
  // Signed read facts bind revision/hash and expire. Keys and raw Gate decisions are
  // captured by the existing pkiKeys and Feature gates loops in snapshot-api.
  for (const p of ctx.policies) await save('policyExceptionSources', { id: p.policyId });
  const shown = ctx.policies.filter((p) => p.status === 'APPROVED' || p.status === 'DEPLOYED');
  const versions = new Set<string>();
  for (const p of shown) {
    await save('policyReleaseGate', { id: p.policyId });
    const key = `${p.featureId}@${p.featureVersion}`;
    if (versions.has(key)) continue;
    versions.add(key);
    await save('exceptionPolicies', {}, { featureId: p.featureId, featureVersion: p.featureVersion, active: 'true' });
  }
  return { exceptions: list.items.length, panels: shown.length };
}
