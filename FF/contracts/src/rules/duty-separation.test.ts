// IAM 직무 분리 — FFG-PLT-016 합격: 겸직 계정 0건, 긴급 권한 사용 100%에 사후 검토 기록
import { describe, expect, it } from 'vitest';
import { DEMO_PERSONAS, dutiesOf, dutyConflicts, postReviewBlocker } from './duty-separation';

describe('IAM 직무 분리 (FFG-PLT-016)', () => {
  it('FFG-PLT-016 두 직무 이상을 가진 계정을 찾는다 — 한 직무만이면 겸직 아님', () => {
    expect(dutiesOf(['FEATURE_APPROVER', 'RELEASE_MANAGER'])).toEqual(['REQUIREMENT_APPROVAL', 'RELEASE']);
    expect(dutyConflicts({ a: ['FEATURE_APPROVER'], b: ['RELEASE_MANAGER'], c: ['OPERATOR', 'OPS_LEAD'], d: ['GATE_JUDGE', 'SAFETY_OFFICER'] })).toEqual([]);
    expect(dutyConflicts({ x: ['RELEASE_MANAGER', 'OPS_LEAD', 'AUDITOR'] })).toEqual([{ account: 'x', duties: ['RELEASE', 'KILL_EXECUTION'], roles: ['RELEASE_MANAGER', 'OPS_LEAD'] }]);
  });

  it('FFG-PLT-016 현재 데모 계정 감사 — 겸직 3건(구성 승인·PLM 기준정보·협의 이관)이 발견으로 드러난다(계정 재구성은 사용자 결정 대기)', () => {
    expect(dutyConflicts(DEMO_PERSONAS).map((c) => [c.account, c.duties])).toEqual([
      ['approver', ['REQUIREMENT_APPROVAL', 'RELEASE']],
      ['steward', ['REQUIREMENT_APPROVAL', 'RESTORE_APPROVAL']],
      ['coordinator', ['RELEASE', 'KILL_EXECUTION']],
    ]);
  });

  it('FFG-PLT-016 긴급 권한 사후 검토자는 그 명령의 요청자·승인자가 아니다', () => {
    const cmd = { requestedBy: 'usr-ops', approvers: ['usr-safety', 'usr-opslead'] };
    expect(postReviewBlocker(cmd, 'usr-ops')).toMatch(/요청자/);
    expect(postReviewBlocker(cmd, 'usr-safety')).toMatch(/승인자/);
    expect(postReviewBlocker(cmd, 'usr-csm')).toBeNull();
  });
});
