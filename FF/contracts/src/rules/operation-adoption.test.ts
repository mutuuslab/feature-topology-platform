// 홈 'Feature 적용 현황' 집계 — 깔때기는 앞 단계를 지난 차량만 세고(늘지 않음), 상태는 차량 지도(activationState)와 같은 뜻,
// 자동 선택은 긴급 차단 → 단계 배포 → 최근 배포, 회신·평가 원천이 없으면 그 단계는 null(지어내지 않는다).
import { describe, expect, it } from 'vitest';
import { ADOPTION_BY_CODE, adoptionCandidates, operationAdoption } from './operation-adoption';
import { activationState } from './fleet-map';
import { operationSummary, type OperationInput } from './operation-overview';

const vins = Array.from({ length: 10 }, (_, i) => `V${i}`);
const flag = (flagKey: string, value: boolean, reason = 'POLICY_MATCH', publicationId = 'PUB-A') => ({ flagKey, publicationId, sequence: 1, local: { value, reason }, drift: false });
const base = (): OperationInput => ({
  runtime: vins.map((vin, i) => ({
    vin, scope: 'x', quality: 'TRUSTED', link: i === 9 ? 'OFFLINE' : 'ONLINE', last: null,
    kills: i === 8 ? ['F-K'] : [],
    flags: i < 7 ? [flag('a', i !== 6), flag('k', true, 'POLICY_MATCH', 'PUB-K')] : i === 8 ? [flag('k', false, 'KILL_SWITCH', 'PUB-K')] : [],
  })) as OperationInput['runtime'],
  vehicles: vins.map((vin, i) => ({ vin, country: i < 6 ? 'KR' : 'US', canary: i < 2 }) as OperationInput['vehicles'][number]),
  policies: [
    { policyId: 'P-A', revision: 1, featureId: 'F-A', featureVersion: '1', flagKey: 'a', status: 'DEPLOYED', deployedAt: '2026-11-01T00:00:00Z', stageBasisPoints: 500 },
    { policyId: 'P-K', revision: 2, featureId: 'F-K', featureVersion: '1', flagKey: 'k', status: 'DEPLOYED', deployedAt: '2026-10-01T00:00:00Z' },
    { policyId: 'P-R', revision: 1, featureId: 'F-R', featureVersion: '1', flagKey: 'r', status: 'DEPLOYED', deployedAt: '2026-11-02T00:00:00Z' },
    { policyId: 'P-D', revision: 1, featureId: 'F-D', featureVersion: '1', flagKey: 'd', status: 'DRAFT' },
  ] as OperationInput['policies'],
  features: [],
  publications: [
    { publicationId: 'PUB-A', kind: 'POLICY', status: 'CONFIRMED', createdAt: '2026-11-01T00:00:00Z', payload: { targets: vins.slice(0, 8), flagKey: 'a', featureId: 'F-A', policy: { policyId: 'P-A', revision: 1 } } },
    { publicationId: 'PUB-K', kind: 'POLICY', status: 'CONFIRMED', createdAt: '2026-10-01T00:00:00Z', payload: { targets: vins.slice(0, 9), flagKey: 'k', featureId: 'F-K', policy: { policyId: 'P-K', revision: 2 } } },
    { publicationId: 'PUB-X', kind: 'KILL', status: 'CONFIRMED', createdAt: '2026-11-03T00:00:00Z', payload: { targets: ['V8'], flagKey: null, featureId: 'F-K', policy: null, kill: { featureIds: ['F-K'] } } },
  ] as OperationInput['publications'],
  readbacks: [
    ...vins.slice(0, 5).map((vin, i) => ({ vin, publicationId: 'PUB-A', at: `2026-11-01T00:00:0${i + 1}.000Z`, metricType: 'READBACK', observed: 'h' })),
    { vin: 'V8', publicationId: 'PUB-X', at: '2026-11-03T00:00:05.000Z', metricType: 'READBACK', observed: 'DISABLED' },
  ],
  syncs: [],
});

describe('Feature 적용 현황 집계', () => {
  it('자동 선택 — 긴급 차단 중 Feature의 Flag가 먼저, 다음 단계 배포, 최근 배포. 배포되지 않은 정책은 빠진다', () => {
    expect(adoptionCandidates(base()).map((c) => [c.flagKey, c.why])).toEqual([['k', 'KILL'], ['a', 'CANARY'], ['r', 'RECENT']]);
  });

  it('상태는 차량 지도와 같은 뜻 — 적용 중 단계 배포 코호트만 CANARY로 가른다', () => {
    const input = base();
    const a = operationAdoption(input, true).flags.find((f) => f.flagKey === 'a')!;
    input.runtime.forEach((r, i) => {
      const map = activationState({ link: r.link as 'ONLINE' | 'OFFLINE', kills: [], flags: r.flags }, 'a');
      const s = ADOPTION_BY_CODE[a.state[i]];
      expect(s === 'CANARY' ? 'ON' : s).toBe(map);
    });
    expect(a.states).toEqual({ ON: 4, CANARY: 2, OFF: 3, DISABLED: 0, UNKNOWN: 1 });
    expect(a.stagePct).toBe(5);
  });

  it('깔때기는 앞 단계를 지난 차량만 센다 — 대상 8 → 전달 7 → 수신 5 → 적용 5', () => {
    const a = operationAdoption(base(), true).flags.find((f) => f.flagKey === 'a')!;
    expect(a.funnel).toEqual({ TARGET: 8, DELIVERED: 7, RECEIVED: 5, APPLIED: 5, USED: null });
    const order = ['TARGET', 'DELIVERED', 'RECEIVED', 'APPLIED'] as const;
    for (let i = 1; i < order.length; i++) expect(a.funnel[order[i]]!).toBeLessThanOrEqual(a.funnel[order[i - 1]]!);
    expect(a.stage).toBe('4444422100');
  });

  it('회신을 읽지 못하면 수신 단계 null, 평가 기록이 있으면 실제 사용 단계를 센다', () => {
    const input = { ...base(), evaluations: [{ vin: 'V0', flagKey: 'a', at: '2026-11-01T01:00:00Z', on: true }, { vin: 'V1', flagKey: 'a', at: '2026-11-01T01:00:00Z', on: false }] };
    const blind = operationAdoption(input, false).flags.find((f) => f.flagKey === 'a')!;
    expect(blind.funnel.RECEIVED).toBeNull();
    // 평가 결과 값과 상관없이 평가한 차량(V0 on·V1 off) — 둘 다 적용 단계를 지났다
    expect(blind.funnel.USED).toBe(2);
    expect(blind.at.every((t) => t === null)).toBe(true);
    // 평가 표본에 그 Flag 기록이 없으면 0대가 아니라 null
    expect(operationAdoption(input, true).flags.find((f) => f.flagKey === 'k')!.funnel.USED).toBeNull();
  });

  it('차단 차량은 차단 회신 시각, 적용 차량은 첫 회신 시각(0.1초) — 시간축 표식은 배포·차단 게시본', () => {
    const k = operationAdoption(base(), true).flags.find((f) => f.flagKey === 'k')!;
    expect(ADOPTION_BY_CODE[k.state[8]]).toBe('DISABLED');
    expect(k.t0).toBe('2026-10-01T00:00:00.000Z');
    expect(k.at[8]).toBe((Date.parse('2026-11-03T00:00:05Z') - Date.parse('2026-10-01T00:00:00Z')) / 100);
    expect(k.markers.map((m) => m.kind)).toEqual(['DEPLOY', 'KILL']);
  });

  it('요약(operationSummary)에 같은 집계가 실리고 국가 코드는 차량 순서대로다', () => {
    const s = operationSummary(base(), '2026-11-04T00:00:00Z', true);
    expect(s.adoption!.vins).toEqual(vins);
    expect(s.adoption!.countries).toEqual(['KR', 'US']);
    expect(s.adoption!.country).toBe('0000001111');
    expect(s.adoption!.flags.map((f) => f.flagKey)).toEqual(['k', 'a', 'r']);
    expect(s.adoption!.evaluations).toBe(false);
  });
});
