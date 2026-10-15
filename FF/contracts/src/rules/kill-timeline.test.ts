// 종료·복원 시간 기록 — FFG-ADS-007 합격: 표본 종료 건 100%에서 시각과 명령 ID가 연결된다 · TEL-004 Kill·고장 구분 · TEL-010 불확실 표시
import { describe, expect, it } from 'vitest';
import { killTimeline, type TimelineReport } from './kill-timeline';

const rep = (o: Partial<TimelineReport>): TimelineReport => ({ vin: 'ego-01', state: 'ACTIVE', request_result: 'NONE', vehicle_seq: 11, observed_at: '2026-10-12T01:00:00.000Z', time_sync: 'SYNCED', edr_aligned_state: 'OFF_BY_COMMAND', reason: { category: 'SAFETY', source: 'REMOTE' }, ...o });
const cmds = [
  { commandId: 'C-DE', request: 'deactivate' as const, vin: 'ego-01', vehicleSeq: 11 },
  { commandId: 'C-RE', request: 'restore' as const, vin: 'ego-01', vehicleSeq: 12 },
];
const reports = [
  rep({ state: 'DEACT_WARNING', request_result: 'ACCEPTED', observed_at: '2026-10-12T01:00:00.300Z' }),
  rep({ state: 'DEACT_RAMP', observed_at: '2026-10-12T01:00:04.300Z' }),
  rep({ state: 'DISABLED', observed_at: '2026-10-12T01:00:07.300Z' }),
  rep({ state: 'RESTORE_PENDING', request_result: 'ACCEPTED', vehicle_seq: 12, observed_at: '2026-10-12T02:00:00.000Z', time_sync: 'DEGRADED' }),
  rep({ state: 'ACTIVE', vehicle_seq: 12, observed_at: '2026-10-12T02:00:02.000Z', reason: { category: 'SAFETY', source: 'STARTUP' } }),
];

describe('종료·복원 시간 기록 (FFG-ADS-007 · FFG-TEL-004 · FFG-TEL-010)', () => {
  it('명령 ID별 종료 수락·비활성화 완료·복원 수락·복원 효력 — 원격 Kill, EDR 정합 상태', () => {
    const t = killTimeline('ego-01', cmds, reports, { adsFeature: false });
    expect(t.deactivate).toMatchObject({ commandId: 'C-DE', accepted: { at: '2026-10-12T01:00:00.300Z', trust: 'TRUSTED' }, completed: { at: '2026-10-12T01:00:07.300Z' }, mrc: null, mrcApplicable: false });
    expect(t.restore).toMatchObject({ commandId: 'C-RE', accepted: { at: '2026-10-12T02:00:00.000Z', trust: 'UNCERTAIN', timeSync: 'DEGRADED' }, effective: { at: '2026-10-12T02:00:02.000Z' } });
    expect(t).toMatchObject({ cause: 'REMOTE_KILL', edrAtCompletion: 'OFF_BY_COMMAND', uncertain: ['복원 수락'] });
  });

  it('차량 내 고장으로 꺼졌으면 ONBOARD_FAULT — 원격 Kill과 구분된다', () => {
    const t = killTimeline('ego-01', cmds.slice(0, 1), [rep({ state: 'DISABLED', reason: { category: 'SAFETY', source: 'ONBOARD' }, edr_aligned_state: 'FAULT' })], { adsFeature: true });
    expect(t).toMatchObject({ cause: 'ONBOARD_FAULT', edrAtCompletion: 'FAULT', deactivate: { accepted: null, mrcApplicable: true }, restore: null });
  });

  it('보고가 없으면 시각은 비고 원인은 UNKNOWN — 다른 차량 보고는 섞지 않는다', () => {
    expect(killTimeline('lead-01', cmds, reports, { adsFeature: false })).toMatchObject({ deactivate: null, restore: null, cause: 'UNKNOWN', uncertain: [] });
  });
});
