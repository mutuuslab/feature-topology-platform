// 보존과 삭제 — FFG-TEL-008 합격: 기간 초과 데이터 0건, 열린 Incident 데이터의 삭제 0건
import { describe, expect, it } from 'vitest';
import { RETENTION_POLICIES, retentionCutoff, retentionPolicy, retentionVerdict, type RetentionHolds } from './retention';

const NOW = '2026-10-15T00:00:00.000Z';
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const none: RetentionHolds = { vehicles: new Map(), features: new Map() };

describe('보존과 삭제 (FFG-TEL-008)', () => {
  it('FFG-TEL-008 저장소마다 13.1 범주와 13.7 기간이 하나씩 — Safety Case·시장 최장 기록은 sweep 대상이 아니다', () => {
    expect(new Set(RETENTION_POLICIES.map((p) => p.store)).size).toBe(RETENTION_POLICIES.length);
    for (const s of ['audit', 'gate_decision', 'sums_record']) expect(retentionCutoff(retentionPolicy(s)!, NOW)).toBeNull();
    expect(retentionPolicy('security_event')!.period).toMatchObject({ kind: 'DAYS', days: 1095, assumed: false }); // 중국 국외 이전 로그 3년 이상
    // 상태 보고·적용 확인은 정기 보고 전년 비교를 위해 730일(가정값)
    for (const s of ['status_report', 'readback']) expect(retentionPolicy(s)!.period).toMatchObject({ kind: 'DAYS', days: 730, assumed: true });
    // 개인정보가 들어갈 수 있는 기록은 짧은 기간
    for (const p of RETENTION_POLICIES.filter((x) => x.personal)) expect(p.period.kind === 'DAYS' && p.period.days <= 30).toBe(true);
  });

  it('FFG-TEL-008 기간 안 KEEP, 지나면 DELETE, 열린 Incident에 연결된 차량·Feature면 HOLD(삭제 0건)', () => {
    const p = retentionPolicy('status_report')!;
    expect(retentionVerdict({ at: daysAgo(10), vehicle: 'ego-01', featureId: 'FEAT-00022' }, p, NOW, none)).toEqual({ verdict: 'KEEP' });
    expect(retentionVerdict({ at: daysAgo(800), vehicle: 'ego-01', featureId: 'FEAT-00022' }, p, NOW, none)).toEqual({ verdict: 'DELETE' });
    const holds: RetentionHolds = { vehicles: new Map([['ego-01', ['INC-00001']]]), features: new Map([['FEAT-00022', ['INC-00001', 'ANM-00002']]]) };
    expect(retentionVerdict({ at: daysAgo(800), vehicle: 'ego-01', featureId: 'FEAT-00022' }, p, NOW, holds)).toEqual({ verdict: 'HOLD', refs: ['INC-00001', 'ANM-00002'] });
    expect(retentionVerdict({ at: daysAgo(800), vehicle: 'lead-01', featureId: 'FEAT-00145' }, p, NOW, holds)).toEqual({ verdict: 'DELETE' });
    // Safety Case 기록은 몇 년이 지나도 KEEP
    expect(retentionVerdict({ at: daysAgo(5000), vehicle: null, featureId: null }, retentionPolicy('audit')!, NOW, none)).toEqual({ verdict: 'KEEP' });
  });
});
