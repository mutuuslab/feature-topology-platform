// 서명 검증에 실패한 분석을 화면의 PASS 전제에서 제외한다 — 서버와 화면의 판정이 같아야 한다.
import { describe, expect, it } from 'vitest';
import { gateEvidenceBlockers, gateEvidenceInputOf, type AnalysisRecord, type AnalysisView } from './gate-evidence';

const record: AnalysisRecord = {
  recordId: 'ANL-00001', kind: 'HARA', featureId: 'FEAT-00022', version: '0.1.0',
  docId: 'HARA-001', content: { asil: 'B', safetyGoals: [] }, reason: '서명 검증 시험',
  signedBy: 'usr-quality', signedRole: 'SAFETY_OFFICER', signedAt: '2026-11-05T00:00:00Z',
  provenance: 'PERSONAL', supersedes: null, kid: 'APPROVAL-1', sig: 'invalid',
};
const view: AnalysisView = {
  featureId: record.featureId, version: record.version, lifecycle: 'PROPOSED', asil: 'B',
  security: { relevant: true, why: '보안 관련' }, asilDeviation: null,
  current: {
    HARA: { ...record, valid: false },
    TARA: { ...record, recordId: 'ANL-00002', kind: 'TARA', valid: true },
  },
  history: [], g7: [],
};

describe('화면의 Gate 근거 투영', () => {
  it('서명이 무효인 HARA는 G2 PASS를 막고, 유효한 TARA는 유지한다', () => {
    const input = gateEvidenceInputOf(view, 'G2', 'PASS', false);
    expect(input.current.HARA).toBeUndefined();
    expect(input.current.TARA?.recordId).toBe('ANL-00002');
    expect(gateEvidenceBlockers(input)).toEqual([expect.stringContaining('HARA')]);
  });

  it('유효한 HARA라도 TARA 서명이 무효면 보안 관련 G2 PASS를 막는다', () => {
    const input = gateEvidenceInputOf({ ...view, current: {
      HARA: { ...record, valid: true },
      TARA: { ...record, recordId: 'ANL-00002', kind: 'TARA', valid: false },
    } }, 'G2', 'PASS', false);
    expect(gateEvidenceBlockers(input)).toEqual([expect.stringContaining('TARA')]);
  });
});
