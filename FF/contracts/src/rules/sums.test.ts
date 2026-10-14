// SUMS 기록 — FFG-LCY-008 합격: 표본 명령 100%에 네 항목이 있고, 보존 기간 설정이 Profile의 최대값 이상
import { describe, expect, it } from 'vitest';
import { loadGuide } from '../testing/fixtures';
import { COMPLIANCE_PROFILES, sumsRetention } from './compliance-profile';
import { sumsEntry } from './sums';

describe('SUMS 기록 (FFG-LCY-008)', () => {
  it('보고서 예시 안전 Kill → RXSWIN·형식승인 영향 평가·사용자 고지 항목이 모두 기록된다', () => {
    const e = sumsEntry(loadGuide('schema/examples/kill_safety_dc2_eu.ok.json'));
    expect(e.missing).toEqual([]);
    expect(e).toMatchObject({ request: 'deactivate', rxswin: expect.any(String), typeApproval: { r156AssessmentId: expect.any(String) }, userNotice: { required: expect.any(Boolean) } });
  });

  it('빠진 항목은 감사에서 보이게 — RXSWIN 없음, 고지가 필요한데 문안 없음', () => {
    const cmd = loadGuide('schema/examples/kill_safety_dc2_eu.ok.json');
    const e = sumsEntry({ ...cmd, target: { ...cmd.target, rxswin: '' }, user_notice: { required: true } });
    expect(e.missing).toEqual(['RXSWIN', '사용자 고지 문안']);
  });

  it('보존 기간 = Profile 최대값(중국 GB 44496 생산 중단 후 10년), 값이 없는 Profile은 원문 확인 목록', () => {
    const r = sumsRetention();
    expect(r).toMatchObject({ yearsAfterProductionEnd: 10, basis: expect.stringMatching(/^CN GB 44496/) });
    expect(r.unknown).toHaveLength(COMPLIANCE_PROFILES.length - 1);
    expect(sumsRetention([{ ...COMPLIANCE_PROFILES[0], sumsRetention: { yearsAfterProductionEnd: 15, basis: 'x' } }, ...COMPLIANCE_PROFILES]).yearsAfterProductionEnd).toBe(15);
  });
});
