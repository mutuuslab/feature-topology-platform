// Feature Flag 5단계의 진행 중 긴급 차단 — 서버·시뮬레이터 공용 규칙
import { describe, expect, it } from 'vitest';
import { flagKillOf } from './flag-kill';

describe('flagKillOf — Flag의 Feature를 차단 중인 차단', () => {
  it('ACTIVE 차단만, 함께 차단한(REQUIRES) Feature도, 가장 최근 것 하나', () => {
    const kills = [
      { killId: 'KILL-00001', status: 'RELEASED', featureId: 'FEAT-00022', delivery: { confirmed: 2, denominator: 2 } },
      { killId: 'KILL-00002', status: 'ACTIVE', featureId: 'FEAT-00022', featureIds: ['FEAT-00022', 'FEAT-00188'], delivery: { confirmed: 1, denominator: 2 } },
      { killId: 'KILL-00003', status: 'REQUESTED', featureId: 'FEAT-00022' },
    ];
    expect(flagKillOf('FEAT-00022', kills)).toEqual({ killId: 'KILL-00002', confirmed: 1, denominator: 2 });
    expect(flagKillOf('FEAT-00188', kills)).toEqual({ killId: 'KILL-00002', confirmed: 1, denominator: 2 });
    expect(flagKillOf('FEAT-00023', kills)).toBeNull();
    expect(flagKillOf(null, kills)).toBeNull();
  });
  it('게시 전(회신 집계 없음)이면 반영 0/대상 차량 수', () => {
    expect(flagKillOf('F', [{ killId: 'KILL-00009', status: 'ACTIVE', featureId: 'F', delivery: null, vins: ['a', 'b', 'c'] }])).toEqual({ killId: 'KILL-00009', confirmed: 0, denominator: 3 });
  });
});
