// 배포와 효력 분리·단계적 확대 — FFG-LCY-009 수용 기준: F2 이상 확대 100%에 Canary 결과와 중단 기준 판정이 있다
import { describe, expect, it } from 'vitest';
import { CANARY_MAX_BP, deployStartBasisPoints, judgeStageChange, type StageChangeInput } from './rollout-stage';

const base: StageChangeInput = { fClass: 'F3', current: 300, to: 5000, since: '2026-10-10T00:00:00Z', now: '2026-10-12T00:00:00Z', actorId: 'usr-operator', deployedBy: 'usr-release', openAnomalies: [], activeKills: [] };
const codes = (i: Partial<StageChangeInput>) => judgeStageChange({ ...base, ...i }).blockers.map((b) => b.code);

describe('단계 조정 판정 (FFG-LCY-009)', () => {
  it('F2 이상: Canary에서 관측 기간(24 h)이 지나고 중단 기준이 없으면 확대 — 판정 기록이 남는다', () => {
    const j = judgeStageChange(base);
    expect(j).toMatchObject({ kind: 'EXPAND', ok: true, criteria: { observedMs: 48 * 3600_000, openAnomalies: [], activeKills: [] } });
  });

  it('F2 이상: Canary 없이 0 → 50% 금지, 관측 기간 미달·열린 이상 징후·진행 중 차단이면 금지', () => {
    expect(codes({ current: 0 })).toEqual(['CANARY_FIRST']);
    expect(codes({ since: '2026-10-11T12:00:00Z' })).toEqual(['OBSERVATION']);
    expect(codes({ openAnomalies: ['ANM-00001'] })).toEqual(['STOP_CRITERIA']);
    expect(codes({ activeKills: ['KILL-00001'] })).toEqual(['STOP_CRITERIA']);
  });

  it('Canary 시작(≤ 5%)·줄이기·멈추기는 언제나 — 배포자와 같은 사람이 넓히면 거부(배포·효력 분리)', () => {
    expect(judgeStageChange({ ...base, current: 0, to: CANARY_MAX_BP })).toMatchObject({ kind: 'CANARY', ok: true });
    expect(judgeStageChange({ ...base, current: 5000, to: 0, openAnomalies: ['ANM-1'] })).toMatchObject({ kind: 'SHRINK', ok: true });
    expect(codes({ actorId: 'usr-release' })).toEqual(['SAME_AS_DEPLOYER']);
    expect(judgeStageChange({ ...base, current: 0, to: CANARY_MAX_BP, actorId: 'usr-release' }).ok).toBe(false);
  });

  it('F0·F1은 Canary 조건 없이 확대(분리만), 분류 없음은 안전 관련으로 본다', () => {
    expect(judgeStageChange({ ...base, fClass: 'F1', current: 0 })).toMatchObject({ kind: 'EXPAND', ok: true, criteria: null });
    expect(codes({ fClass: null, current: 0 })).toEqual(['CANARY_FIRST']);
  });

  it('FFG-LCY-009 배포 직후 범위 — F2 이상·분류 없음은 승인 범위가 넓어도 Canary(5%)에서 시작, F0·F1과 이미 좁은 승인 범위는 그대로', () => {
    expect(deployStartBasisPoints('F3', 10000)).toBe(CANARY_MAX_BP);
    expect(deployStartBasisPoints('F2', 5000)).toBe(CANARY_MAX_BP);
    expect(deployStartBasisPoints(null, 10000)).toBe(CANARY_MAX_BP);
    expect(deployStartBasisPoints('F3', 300)).toBeNull();
    expect(deployStartBasisPoints('F1', 10000)).toBeNull();
  });
});
