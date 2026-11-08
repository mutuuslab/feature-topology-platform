// P10 신규 읽기 — 정적 공개본도 실제 백엔드가 생성한 기록을 읽는다.
import type { SnapshotSave } from './snapshot-p3.ts';

export interface SnapshotP10Context {
  features: { featureId: string; version: string }[];
}

export async function snapshotP10(save: SnapshotSave, ctx: SnapshotP10Context) {
  // F0 소유자/계정 조회를 사용하는 두 화면도 같은 공개 시연 계정 목록을 읽는다.
  await save('accounts');
  await save('featureRetireRequests');
  await save('baselineChangesets');
  await save('releaseCandidates');
  await save('deletedDrafts');
  await save('policyStages');
  const baselines = await save('baselines');
  const ids = [...new Set(ctx.features.map((f) => f.featureId))];
  for (const id of ids) {
    await save('featureHistory', { id });
    await save('featureReviews', { id });
    await save('featureBaselines', { id });
    await save('featureRetireRequests', {}, { featureId: id });
    await save('baselineChangesets', {}, { featureId: id });
    await save('releaseCandidates', {}, { featureId: id });
    const mine = (baselines.items ?? []).filter((b: { featureId: string }) => b.featureId === id);
    // 첫 비교와 같은 Feature의 모든 Version 조합. 다른 Feature 비교는 읽기 계산기가 같은 계약으로 계산한다.
    for (const left of mine) for (const right of mine)
      await save('compareBaselines', {}, { left: left.baselineId, right: right.baselineId });
  }
  for (const f of ctx.features) {
    const params = { id: f.featureId, ver: f.version };
    await save('gateNaRequests', params);
    await save('releaseCandidate', params);
    await save('featureReviews', { id: f.featureId }, { version: f.version });
  }
}
