// 안전 분류(보고서 v1.1 5장) — 판정 흐름은 보고서 5.6 분류 예와 같고, 조합 검사는 위반 6종을 모두 잡는다(FFG-CLS-009 · TC-FF-23).
import { describe, expect, it } from 'vitest';
import { loadGuide } from '../testing/fixtures';
import type { SafetyProfile } from '../schemas/safety-profile';
import { checkProfile, inferFClass, proposeClass } from './classification';

/** 보고서 부록 D.6 Registry 스냅샷의 FEAT-00022 항목을 프로파일로 */
function feat00022(): SafetyProfile {
  const r = loadGuide('schema/examples/registry.json').features['FEAT-00022'];
  return {
    featureId: 'FEAT-00022', version: r.version, status: 'CONFIRMED', source: 'REPORT_EXAMPLE',
    fClass: r.f_class, deactClass: r.deact_class, regClass: 'R1', flagType: 'OPS', adsFeature: r.ads_feature, adsfType: null, gsrMandatory: r.gsr_mandatory,
    itemIds: [r.item], haraRef: 'HARA-SCC-01', asilRef: r.asil_ref, safetyGoalIds: ['SG-SCC-01'], safeState: 'BASE_ONLY', endState: 'DISABLED',
    takeoverMs: r.profile.takeover_ms, rampMs: r.profile.ramp_ms, faultRampMs: r.profile.fault_ramp_ms, faultTolerantTimeMs: 5000,
    maxPendingMs: r.profile.max_pending_ms, maxCycleWaitMs: r.profile.max_cycle_wait_ms,
    maxActivationScope: { vehicles: r.max_vehicles, perWindow: r.max_per_window }, markets: r.markets_approved, rxswin: [],
    approvalProfile: 'AP-F3', evidenceManifestId: null, sbomRef: null, rollbackTarget: null, expiresAt: null, retirementPlan: null,
    confirmedBy: null, confirmedAt: null, confirmSig: null,
  };
}

describe('판정 흐름 — 보고서 5.6 분류 예', () => {
  const base = { mandatory: false, safetyRelevant: false, asil: 'QM' as const, changesActiveControl: false, typeApproval: false, ads: false };
  it.each([
    ['UI 테마', {}, ['F0', 'DC0', 'R0']],
    ['경로 사전 안내', { changesActiveControl: true }, ['F1', 'DC1', 'R0']],
    ['FEAT-00022 안전거리', { safetyRelevant: true, asil: 'C', changesActiveControl: true, typeApproval: true }, ['F3', 'DC2', 'R1']],
    ['고속도로 ADS', { safetyRelevant: true, asil: 'D', changesActiveControl: true, typeApproval: true, ads: true }, ['F4', 'DC2', 'R1']],
    ['AEB(의무 기능)', { mandatory: true, safetyRelevant: true, asil: 'D' }, ['F4', 'DC4', 'R2']],
  ] as const)('%s → %j', (_n, a, want) => {
    const p = proposeClass({ ...base, ...a });
    expect([p.fClass, p.deactClass, p.regClass]).toEqual(want);
  });
});

describe('조합 검사 (FFG-CLS-009 · TC-FF-23)', () => {
  it('보고서 Registry 예시(FEAT-00022 F3·DC2)는 통과', () => {
    expect(checkProfile(feat00022())).toEqual([]);
  });
  it.each([
    ['F2 이상에 DC0', { deactClass: 'DC0' as const }, 'deactClass'],
    ['DC2 인계 시간 0', { takeoverMs: 0 }, 'takeoverMs'],
    ['DC2 램프 시간 0', { rampMs: 0 }, 'rampMs'],
    ['F2 이상 고장 램프 0', { faultRampMs: 0 }, 'faultRampMs'],
    ['DC1 대기 상한 0', { deactClass: 'DC1' as const, maxPendingMs: 0 }, 'maxPendingMs'],
    ['DC1~DC3 다음 시동 대기 0', { maxCycleWaitMs: 0 }, 'maxCycleWaitMs'],
  ])('위반 조합: %s', (_n, patch, field) => {
    const f = checkProfile({ ...feat00022(), ...patch });
    expect(f.some((x) => x.rule === 'FFG-CLS-009' && x.field === field)).toBe(true);
  });
  it('F2 이상 Experiment 금지(FFG-CLS-006), ADS는 DC4 불가(FFG-ADS-002), 의무 기능은 DC4(FFG-CLS-005)', () => {
    expect(checkProfile({ ...feat00022(), flagType: 'EXPERIMENT', expiresAt: '2027-01-01', retirementPlan: 'RP-1' }).map((x) => x.rule)).toContain('FFG-CLS-006');
    expect(checkProfile({ ...feat00022(), fClass: 'F4', adsFeature: true, adsfType: 'ADSF-1', deactClass: 'DC4' }).map((x) => x.rule)).toContain('FFG-ADS-002');
    expect(checkProfile({ ...feat00022(), regClass: 'R2' }).map((x) => x.rule)).toContain('FFG-CLS-005');
  });
});

describe('초안 추정 — 높은 쪽(과소평가 방지)', () => {
  it('ASIL과 연결 SW 등급 중 높은 F 등급', () => {
    expect(inferFClass('B', ['F2', 'F2'])).toBe('F2');
    expect(inferFClass('QM', ['F3'])).toBe('F3');
    expect(inferFClass('C', ['F1'])).toBe('F3');
    expect(inferFClass('QM', [])).toBe('F1');
  });
});
