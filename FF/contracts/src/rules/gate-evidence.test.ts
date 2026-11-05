// 분석 근거·Gate 조건(P3-1·3·9·10) — 서버 판정과 화면 미리 막기가 쓰는 순수 함수, 절차 Gate ↔ 플랫폼 Gate 대응표가 업무 절차 모델과 맞는지.
import { describe, expect, it } from 'vitest';
import { GATES } from '../enums';
import { WORKFLOWS } from '../generated/workflows';
import { ROUTES } from '../routes';
import {
  ANALYSIS_AUTHOR_ROLE,
  gateEvidenceBlockers,
  gateStageBlocker,
  HomologationBody,
  HaraBody,
  PROCEDURE_GATE_MAP,
  procedureGateMapValid,
  procedureGateText,
  procedureGatesFor,
  securityRelevance,
  type GateEvidenceInput,
} from './gate-evidence';

const base: GateEvidenceInput = { gate: 'G2', inputResult: 'PASS', current: {}, securityRelevant: false, asilDeviation: null, asilReasonReviewed: false, g7: [] };

describe('G2 분석 근거', () => {
  it('HARA가 없으면 PASS 불가, 보안 관련이면 TARA도', () => {
    expect(gateEvidenceBlockers(base)).toEqual([expect.stringContaining('HARA')]);
    expect(gateEvidenceBlockers({ ...base, securityRelevant: true })).toHaveLength(2);
    expect(gateEvidenceBlockers({ ...base, securityRelevant: true, current: { HARA: { recordId: 'ANL-00001' }, TARA: { recordId: 'ANL-00002' } } })).toEqual([]);
  });

  it('대표 ASIL을 바꾼 Version은 판정자의 사유 검토 확인이 있어야 PASS', () => {
    const dev = { ...base, current: { HARA: { recordId: 'ANL-00001' } }, asilDeviation: { from: 'B', to: 'C', reason: 'HARA 결과 C', refId: 'AD-LON-002' } };
    const why = gateEvidenceBlockers(dev);
    expect(why).toEqual(["대표 ASIL B → C 변경 사유를 검토했다는 확인이 없습니다 — 사유를 읽고 'ASIL 사유 검토함'을 고릅니다."]);
    expect(gateEvidenceBlockers({ ...dev, asilReasonReviewed: true })).toEqual([]);
  });

  it('PASS가 아닌 판정(CONDITIONAL·FAIL)은 근거가 없어도 남길 수 있다 — 빠졌다는 판정 자체가 기록', () => {
    expect(gateEvidenceBlockers({ ...base, inputResult: 'FAIL' })).toEqual([]);
    expect(gateEvidenceBlockers({ ...base, inputResult: 'CONDITIONAL' })).toEqual([]);
  });

  it('사유에 내부 코드·사람 ID가 없다', () => {
    const all = [...gateEvidenceBlockers({ ...base, securityRelevant: true, asilDeviation: { from: 'A', to: 'C', reason: 'x', refId: null } }), ...gateEvidenceBlockers({ ...base, gate: 'G7', g7: [{ role: 'SAFETY_OFFICER', signedBy: 'usr-a' }, { role: 'SECURITY_OFFICER', signedBy: 'usr-a' }] })];
    for (const m of all) expect(m).not.toMatch(/GUARD_FAILED|usr-|FPW\.|SOD-|REFDB_/);
  });
});

describe('G7 두 사람 서명', () => {
  const g7 = { ...base, gate: 'G7' as const };
  it('SM·CSM 서명이 모두 있어야 하고, 같은 사람이면 막는다', () => {
    expect(gateEvidenceBlockers(g7)).toHaveLength(2);
    expect(gateEvidenceBlockers({ ...g7, g7: [{ role: 'SAFETY_OFFICER', signedBy: 'usr-safety2' }] })).toEqual([expect.stringContaining('사이버보안')]);
    expect(gateEvidenceBlockers({ ...g7, g7: [{ role: 'SAFETY_OFFICER', signedBy: 'usr-x' }, { role: 'SECURITY_OFFICER', signedBy: 'usr-x' }] })).toEqual([expect.stringContaining('같은 사람')]);
    expect(gateEvidenceBlockers({ ...g7, g7: [{ role: 'SAFETY_OFFICER', signedBy: 'usr-safety2' }, { role: 'SECURITY_OFFICER', signedBy: 'usr-integrator' }] })).toEqual([]);
  });
});

describe('판정 단계 가드(P3-10)', () => {
  it('단계 밖 Gate·앞 단계 미통과·읽기 전용을 사람이 읽는 사유로', () => {
    expect(gateStageBlocker({ lifecycle: 'PROPOSED', gate: 'G4', role: 'GATE_JUDGE', latest: {} })!.reason).toBe('G4은(는) DEVELOPING 단계 Gate입니다 — 지금은 PROPOSED 단계라 판정할 수 없습니다.');
    expect(gateStageBlocker({ lifecycle: 'DEVELOPING', gate: 'G4', role: 'GATE_JUDGE', latest: { G1: 'PASS', G2: 'PASS', G3: '검토 중' } })!.reason).toContain('앞 단계 G3');
    expect(gateStageBlocker({ lifecycle: 'RELEASED', gate: 'G1', role: 'GATE_JUDGE', latest: {} })).toMatchObject({ readOnly: true });
    expect(gateStageBlocker({ lifecycle: 'PROPOSED', gate: 'G1', role: 'SAFETY_OFFICER', latest: {} })!.reason).toContain('G7만');
    expect(gateStageBlocker({ lifecycle: 'PROPOSED', gate: 'G2', role: 'GATE_JUDGE', latest: {} })).toBeNull();
    for (const g of GATES) {
      const r = gateStageBlocker({ lifecycle: 'PROPOSED', gate: g, role: 'GATE_JUDGE', latest: {} });
      if (r) expect(r.reason).not.toMatch(/GUARD_FAILED|IMMUTABLE/);
    }
  });
});

describe('분석 기록 본문·역할', () => {
  it('종류마다 담당 역할 하나 — 서명 경로의 역할과 같다', () => {
    const route = (n: string) => ROUTES.find((r) => r.name === n)!;
    expect(route('recordHara').roles).toEqual([ANALYSIS_AUTHOR_ROLE.HARA]);
    expect(route('recordTara').roles).toEqual([ANALYSIS_AUTHOR_ROLE.TARA]);
    expect(route('recordSotif').roles).toEqual([ANALYSIS_AUTHOR_ROLE.SOTIF]);
    expect(route('recordHomologation').roles).toEqual([ANALYSIS_AUTHOR_ROLE.HOMOLOGATION]);
    expect(route('signG7Safety').roles).toEqual(['SAFETY_OFFICER']);
    expect(route('signG7Security').roles).toEqual(['SECURITY_OFFICER']);
  });
  it('HARA는 안전 목표 하나 이상, 형식승인 영향이 있으면 규정 하나 이상', () => {
    expect(HaraBody.safeParse({ docId: 'HARA-1', asil: 'C', safetyGoals: [], reason: '분석' }).success).toBe(false);
    expect(HomologationBody.safeParse({ regulations: [], decision: 'NOTIFY', reason: '판단' }).success).toBe(false);
    expect(HomologationBody.safeParse({ regulations: [], decision: 'NO_IMPACT', reason: '판단' }).success).toBe(true);
  });
  it('보안 관련 — 형식승인 영향 등급(R1·R2) 또는 ADS', () => {
    expect(securityRelevance({ regClass: 'R0', adsFeature: false }).relevant).toBe(false);
    expect(securityRelevance({ regClass: 'R1', adsFeature: false }).relevant).toBe(true);
    expect(securityRelevance({ regClass: 'R0', adsFeature: true }).relevant).toBe(true);
  });
});

describe('절차 Gate ↔ 플랫폼 Gate(P3-9)', () => {
  const decisions = WORKFLOWS.processes.flatMap((p) => p.activities.filter((a) => a.gateDecision).map((a) => ({ id: a.id, gate: a.gateDecision!, platformGates: a.platform.gates })));

  it('모델의 모든 gate_decision이 대응표에 있고, 대응표의 플랫폼 Gate는 실재한다', () => {
    expect(decisions.length).toBeGreaterThan(0);
    for (const d of decisions) expect(PROCEDURE_GATE_MAP.map((m) => m.procedureGate), d.id).toContain(d.gate);
    expect(procedureGateMapValid()).toBe(true);
  });

  it('모델 활동이 적은 플랫폼 Gate는 대응표 안에 있다(모델이 대응표와 다른 Gate를 가리키지 않는다)', () => {
    for (const d of decisions) {
      const m = PROCEDURE_GATE_MAP.find((x) => x.procedureGate === d.gate)!;
      for (const g of d.platformGates) expect(m.platformGates, `${d.id} gates ${g}`).toContain(g);
    }
  });

  it('두 곳이 같은 문장 — 절차 G2 = 플랫폼 G2 + G7', () => {
    expect(procedureGateText('G2')).toBe('절차 G2 HARA 영향 = 플랫폼 G2 Requirement Gate + G7 Safety/Security Gate');
    expect(procedureGatesFor('G7').map((m) => m.procedureGate)).toEqual(['G2', 'G4']);
  });
});
