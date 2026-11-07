// 정적 데모 스냅샷 — 묶음 P1(컴플라이언스 룰 레지스트리, /verify/compliance?tab=registry)의 GET 응답.
// tools/snapshot-api.ts main()에서 `await snapshotP1(save, { contracts })` 한 줄로 부른다(통합 때 연결). 화면이 보내는 질의 모양 그대로:
//  · complianceRules(질의 없음 — 화면이 상태·유형·지역을 걸러 보인다), 룰마다 complianceRule {id}와 후보 Feature(complianceCandidateQuery 키 순서)
//  · complianceValidations(질의 없음), 결과에 나오는 정책마다 complianceRulesApplicable { policyId }(첫 줄은 열 때 바로, 나머지는 줄을 고르면)
type Save = (name: string, params?: Record<string, string>, query?: Record<string, any>, headers?: Record<string, string>) => Promise<any>;

export interface SnapshotP1Context {
  /** contracts dist(index.js) — complianceCandidateQuery를 화면과 같게 쓴다 */
  contracts: Pick<typeof import('../contracts/src/index'), 'complianceCandidateQuery'>;
}

export async function snapshotP1(save: Save, ctx: SnapshotP1Context): Promise<{ rules: number; checks: number }> {
  const rules = (await save('complianceRules')) as { items: { ruleId: string; scope: Parameters<SnapshotP1Context['contracts']['complianceCandidateQuery']>[0] }[] };
  for (const r of rules.items) {
    await save('complianceRule', { id: r.ruleId });
    await save('complianceRuleCandidates', {}, ctx.contracts.complianceCandidateQuery(r.scope));
  }
  const checks = (await save('complianceValidations')) as { items: { policyId: string }[] };
  for (const policyId of new Set(checks.items.map((c) => c.policyId))) await save('complianceRulesApplicable', {}, { policyId });
  return { rules: rules.items.length, checks: checks.items.length };
}
