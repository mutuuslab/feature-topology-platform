// 배포와 효력 분리·단계적 확대 — FFG-LCY-009 수용 기준: F2 이상 확대 100%에 Canary 결과와 중단 기준 판정이 있다
import { describe, expect, it } from 'vitest';
import type { ExpansionResult } from './ads-change';
import { CANARY_MAX_BP, deployStartBasisPoints, judgeExpansion, judgeStageChange, type ExpansionJudgeInput, type ExpansionSources, type StageChangeInput, type StageCriteriaInput } from './rollout-stage';

const base: StageChangeInput = { fClass: 'F3', current: 300, to: 5000, since: '2026-10-10T00:00:00Z', now: '2026-10-12T00:00:00Z', actorId: 'usr-operator', deployedBy: 'usr-release', openAnomalies: [], activeKills: [] };
const codes = (i: Partial<StageChangeInput>) => judgeStageChange({ ...base, ...i }).blockers.map((b) => b.code);
// 확대 판정(통합 D-INT-4) — Canary 규칙 ① 결과와 축별 근거를 한 규칙으로
// 단계 조정은 근거(Canary·축별 근거)를 받아 judgeExpansion을 스스로 부른다 — 단계 기준(관측 기간·열린 이상)까지 같은 규칙
const lake = (verdict: 'OK' | 'ABORT' | 'HOLD_STALE' | 'INSUFFICIENT', lagMinutes: number | null, breached: string[] = [], registered = true): ExpansionSources => ({ canary: { verdict, lagMinutes, breached, registered }, evidence: null });

describe('단계 조정 판정 (FFG-LCY-009)', () => {
  it('사전 등록 중단 기준(TL-B01·B02) — 지표 지연이면 보류, 경계 초과면 중단, 표본 부족·기준 없음은 막지 않는다, 줄이기는 언제나', () => {
    expect(codes({ expansion: lake('HOLD_STALE', 23) })).toEqual(['STALE_DATA']);
    expect(judgeStageChange({ ...base, expansion: lake('HOLD_STALE', 23) }).blockers[0].message).toContain('23분');
    expect(codes({ expansion: lake('ABORT', 2, ['dtc_per_1k']) })).toEqual(['ABORT_CRITERIA']);
    expect(codes({ expansion: lake('INSUFFICIENT', 2) })).toEqual([]);
    expect(codes({ expansion: null })).toEqual([]);
    expect(codes({ expansion: lake('ABORT', 2, ['dtc_per_1k'], false) })).toEqual([]);
    // Canary 시작(F0·F1 포함)도 보류 — 신선도 초과 지표로 넓힌 적 0(INV-16)
    expect(codes({ fClass: 'F1', current: 0, to: CANARY_MAX_BP, expansion: lake('HOLD_STALE', null) })).toEqual(['STALE_DATA']);
    expect(judgeStageChange({ ...base, current: 5000, to: 100, expansion: lake('ABORT', 1, ['dtc_per_1k']) })).toMatchObject({ kind: 'SHRINK', ok: true });
  });

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

// 통합 D-INT-4 — 지표가 늦거나 근거가 모자라면 확대를 보류하는 판정은 하나다. 서버 단계 조정 거부와 정책 상세 패널이 같은 판정을 읽는다
describe('확대 판정 — Canary 규칙 ①과 축별 근거를 한 규칙으로 (D-INT-4)', () => {
  const result = (r: Partial<ExpansionResult> = {}): ExpansionResult => ({ verdict: 'EXPAND', reason: 'OK', combos: [{ comboId: 'A', verdict: 'OK' }], staleMetrics: [], maxDelayMs: 60_000, ...r });
  const ev = (r: Partial<ExpansionResult> = {}, x: Partial<NonNullable<ExpansionJudgeInput['evidence']>> = {}): ExpansionJudgeInput['evidence'] => ({ result: result(r), metrics: [{ key: 'takeoverRate', breached: false }], frozen: null, assumed: false, ...x });
  const codesOf = (i: ExpansionJudgeInput) => judgeExpansion(i).findings.map((f) => `${f.source}:${f.code}:${f.blocking ? 'block' : f.waived}`);
  const FROZEN = { reason: '현장 결함 조사', scope: 'KR 전체', by: 'usr-safety', at: '2026-10-12T00:00:00Z' };

  it('근거가 없으면 확대 가능 — 막는 사유도 알림도 없다', () => {
    expect(judgeExpansion({ canary: null, evidence: null })).toEqual({ verdict: 'EXPAND', blocked: false, findings: [] });
    expect(judgeExpansion({ canary: { verdict: 'OK', lagMinutes: 2, breached: [], registered: false }, evidence: ev() })).toMatchObject({ verdict: 'EXPAND', blocked: false, findings: [] });
  });

  it('Canary: 지연은 언제나 보류(막음), 경계 초과는 사전 등록했을 때만 막고, 표본 부족은 알림만', () => {
    expect(judgeExpansion({ canary: { verdict: 'HOLD_STALE', lagMinutes: 23, breached: [], registered: false }, evidence: null })).toMatchObject({
      verdict: 'HOLD',
      blocked: true,
      findings: [{ source: 'CANARY', code: 'STALE_DATA', verdict: 'HOLD', blocking: true, waived: null, lagMinutes: 23 }],
    });
    expect(judgeExpansion({ canary: { verdict: 'ABORT', lagMinutes: 2, breached: ['dtc_per_1k'], registered: false }, evidence: null })).toMatchObject({
      verdict: 'STOP',
      blocked: false,
      findings: [{ code: 'ABORT_CRITERIA', blocking: false, waived: 'UNREGISTERED', items: ['dtc_per_1k'] }],
    });
    expect(judgeExpansion({ canary: { verdict: 'ABORT', lagMinutes: 2, breached: ['dtc_per_1k'], registered: true }, evidence: null })).toMatchObject({ verdict: 'STOP', blocked: true });
    expect(codesOf({ canary: { verdict: 'INSUFFICIENT', lagMinutes: 2, breached: [], registered: true }, evidence: null })).toEqual(['CANARY:CANARY_INSUFFICIENT:ADVISORY']);
  });

  it('축별 근거: 동결·경보·지표 지연·표본 부족을 축마다 따로 낸다 — 무거운 순(동결 > 중단 > 보류)', () => {
    const j = judgeExpansion({
      canary: null,
      evidence: ev(
        { verdict: 'FROZEN', reason: 'FROZEN', combos: [{ comboId: 'A', verdict: 'ALERT' }, { comboId: 'B', verdict: 'INSUFFICIENT' }], staleMetrics: ['takeoverRate'], maxDelayMs: 125 * 60_000 },
        { metrics: [{ key: 'takeoverRate', breached: false }, { key: 'falseBrakeRate', breached: true }], frozen: FROZEN },
      ),
    });
    expect(j.verdict).toBe('FROZEN');
    expect(j.findings.map((f) => [f.code, f.items])).toEqual([
      ['FROZEN', ['현장 결함 조사', 'KR 전체']],
      ['METRIC_ALERT', ['falseBrakeRate', 'A']],
      ['METRIC_DELAY', ['takeoverRate']],
      ['INSUFFICIENT', ['B']],
    ]);
    expect(j.findings.find((f) => f.code === 'METRIC_DELAY')?.lagMinutes).toBe(125);
  });

  it('근거가 가정값이면 판정은 보이되 확대를 막지 않는다 — 실측 근거는 막는다', () => {
    const delayed = { verdict: 'HOLD', reason: 'METRIC_DELAY', staleMetrics: ['takeoverRate'], maxDelayMs: 125 * 60_000 } as const;
    expect(judgeExpansion({ canary: null, evidence: ev(delayed, { assumed: true }) })).toMatchObject({ verdict: 'HOLD', blocked: false, findings: [{ code: 'METRIC_DELAY', blocking: false, waived: 'ASSUMED' }] });
    expect(judgeExpansion({ canary: null, evidence: ev(delayed) })).toMatchObject({ verdict: 'HOLD', blocked: true });
    // 보고되지 않은 지표는 지연 분을 모른다(무한대) — null
    expect(judgeExpansion({ canary: null, evidence: ev({ ...delayed, maxDelayMs: Number.POSITIVE_INFINITY }) }).findings[0].lagMinutes).toBeNull();
  });

  it('두 근거를 합친다 — Canary 지연과 축별 경보가 같이 있으면 중단이 머리, 막는 사유는 둘 다', () => {
    const i: ExpansionJudgeInput = { canary: { verdict: 'HOLD_STALE', lagMinutes: 15, breached: [], registered: true }, evidence: ev({ verdict: 'STOP', reason: 'METRIC_ALERT' }, { metrics: [{ key: 'takeoverRate', breached: true }] }) };
    expect(judgeExpansion(i)).toMatchObject({ verdict: 'STOP', blocked: true });
    expect(codesOf(i)).toEqual(['EVIDENCE:METRIC_ALERT:block', 'CANARY:STALE_DATA:block']);
  });

  it('단계 조정 거부는 같은 판정의 막는 사유만 쓴다 — 지연 → STALE_DATA, 경보 → ABORT_CRITERIA, 동결 → FROZEN, 표본 부족 → INSUFFICIENT_EVIDENCE', () => {
    const measured: ExpansionSources = {
      canary: null,
      evidence: ev({ verdict: 'FROZEN', reason: 'FROZEN', combos: [{ comboId: 'B', verdict: 'INSUFFICIENT' }], staleMetrics: ['takeoverRate'], maxDelayMs: 40 * 60_000 }, { metrics: [{ key: 'takeoverRate', breached: true }], frozen: FROZEN }),
    };
    expect(codes({ expansion: measured })).toEqual(['FROZEN', 'ABORT_CRITERIA', 'STALE_DATA', 'INSUFFICIENT_EVIDENCE']);
    const j = judgeStageChange({ ...base, expansion: measured });
    expect(j.blockers[0].message).toContain('현장 결함 조사');
    expect(j.blockers[2].message).toContain('takeoverRate');
    expect(j.blockers[2].message).toContain('40분');
    // 가정값 근거·미등록 기준·Canary 표본 부족은 막지 않는다, 줄이기는 언제나
    expect(codes({ expansion: { canary: { verdict: 'INSUFFICIENT', lagMinutes: 1, breached: [], registered: true }, evidence: ev({ verdict: 'HOLD', reason: 'METRIC_DELAY', staleMetrics: ['takeoverRate'] }, { assumed: true }) } })).toEqual([]);
    expect(judgeStageChange({ ...base, current: 5000, to: 300, expansion: measured })).toMatchObject({ kind: 'SHRINK', ok: true });
  });
});

// 통합 D-INT-4 — 단계 기준(Canary 먼저·관측 기간·열린 이상 징후·진행 중 차단)도 같은 확대 판정의 사유다. 패널과 단계 조정 거부가 같은 사유를 읽는다
describe('확대 판정 — 단계 기준(FFG-LCY-009)도 한 판정으로 (D-INT-4)', () => {
  const H = 3600_000;
  const stage = (x: Partial<StageCriteriaInput> = {}): StageCriteriaInput => ({ fClass: 'F3', current: 300, beyondCanary: true, observedMs: 48 * H, openAnomalies: [], activeKills: [], ...x });
  const of = (s: StageCriteriaInput, sources: ExpansionSources = { canary: null, evidence: null }) => judgeExpansion({ ...sources, stage: s });

  it('관측 기간 미달·Canary 없이 시작은 확대 보류(막음), 열린 이상 징후·진행 중 차단은 중단(막음)', () => {
    expect(of(stage({ observedMs: 10 * H }))).toMatchObject({ verdict: 'HOLD', blocked: true, findings: [{ source: 'STAGE', code: 'OBSERVATION', verdict: 'HOLD', blocking: true, observedMs: 10 * H }] });
    expect(of(stage({ current: 0 })).findings.map((f) => f.code)).toEqual(['CANARY_FIRST']);
    const j = of(stage({ observedMs: 10 * H, openAnomalies: ['ANM-00001'], activeKills: ['KILL-00001'] }));
    expect(j.verdict).toBe('STOP');
    expect(j.findings.map((f) => [f.code, f.items])).toEqual([
      ['OPEN_ANOMALY', ['ANM-00001']],
      ['ACTIVE_KILL', ['KILL-00001']],
      ['OBSERVATION', []],
    ]);
  });

  it('F0·F1, Canary 범위 안에서 넓히기는 단계 기준을 보지 않는다 — 분류 없음은 안전 관련', () => {
    expect(of(stage({ fClass: 'F1', current: 0, openAnomalies: ['ANM-1'] })).findings).toEqual([]);
    expect(of(stage({ beyondCanary: false, observedMs: 0 })).findings).toEqual([]);
    expect(of(stage({ fClass: null, current: 0 })).findings.map((f) => f.code)).toEqual(['CANARY_FIRST']);
  });

  it('단계 조정 거부와 패널 판정의 막는 사유가 같다 — 단계 기준·Canary·축별 근거를 한 번에', () => {
    const sources: ExpansionSources = { canary: { verdict: 'HOLD_STALE', lagMinutes: 23, breached: [], registered: true }, evidence: null };
    const input = { ...base, since: '2026-10-11T14:00:00Z', openAnomalies: ['ANM-00001'], activeKills: ['KILL-00001'], expansion: sources };
    const panel = of(stage({ observedMs: 10 * H, openAnomalies: ['ANM-00001'], activeKills: ['KILL-00001'] }), sources);
    const refusal = judgeStageChange(input);
    // 열린 이상 징후·진행 중 차단은 거부 사유 하나(중단 기준 충족)로 묶는다 — 감사·중단 알림 글자는 그대로
    expect(refusal.blockers.map((b) => b.code)).toEqual(['STOP_CRITERIA', 'STALE_DATA', 'OBSERVATION']);
    expect(refusal.blockers[0].message).toBe('중단 기준 충족 — 이상 징후 ANM-00001, 차단 KILL-00001');
    expect(refusal.blockers[2].message).toBe('관측 기간 10시간 < 24시간');
    expect(panel.findings.filter((f) => f.blocking).map((f) => f.code)).toEqual(['OPEN_ANOMALY', 'ACTIVE_KILL', 'STALE_DATA', 'OBSERVATION']);
  });
});
