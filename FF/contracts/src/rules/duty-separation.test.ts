// IAM 직무 분리 — FFG-PLT-016 합격: 겸직 계정 0건, 긴급 권한 사용 100%에 사후 검토 기록
import { describe, expect, it } from 'vitest';
import { SOD_RULES } from './access';
import { DEMO_PERSONAS, dutiesOf, dutyConflicts, postReviewBlocker, refChangeDutyBlocker } from './duty-separation';

describe('IAM 직무 분리 (FFG-PLT-016)', () => {
  it('FFG-PLT-016 두 직무 이상을 가진 계정을 찾는다 — 한 직무만이면 겸직 아님', () => {
    expect(dutiesOf(['FEATURE_APPROVER', 'RELEASE_MANAGER'])).toEqual(['REQUIREMENT_APPROVAL', 'RELEASE']);
    expect(dutyConflicts({ a: ['FEATURE_APPROVER'], b: ['RELEASE_MANAGER'], c: ['OPERATOR', 'OPS_LEAD'], d: ['GATE_JUDGE', 'SAFETY_OFFICER'] })).toEqual([]);
    expect(dutyConflicts({ x: ['RELEASE_MANAGER', 'OPS_LEAD', 'AUDITOR'] })).toEqual([{ account: 'x', duties: ['RELEASE', 'KILL_EXECUTION'], roles: ['RELEASE_MANAGER', 'OPS_LEAD'] }]);
  });

  it('FFG-PLT-016 데모 계정 감사 — 겸직 계정 0건, 직무마다 맡는 계정이 있고 복원용 FSM은 차단용 FSM과 다른 계정', () => {
    expect(dutyConflicts(DEMO_PERSONAS)).toEqual([]);
    const holders = (d: Parameters<typeof dutiesOf>[0][number]) => Object.keys(DEMO_PERSONAS).filter((k) => DEMO_PERSONAS[k].includes(d));
    expect(holders('RELEASE_MANAGER')).toEqual(['coordinator']);
    expect(holders('OPERATOR')).toEqual(['operator']);
    expect(holders('SAFETY_OFFICER')).toEqual(['quality', 'integrator']);
  });

  it('FFG-PLT-016 긴급 권한 사후 검토자는 그 명령의 요청자·승인자가 아니다', () => {
    const cmd = { requestedBy: 'usr-ops', approvers: ['usr-safety', 'usr-opslead'] };
    expect(postReviewBlocker(cmd, 'usr-ops')).toMatch(/요청자/);
    expect(postReviewBlocker(cmd, 'usr-safety')).toMatch(/승인자/);
    expect(postReviewBlocker(cmd, 'usr-csm')).toBeNull();
  });

  it('Feature DB 변경 요청 — 요청자는 자기 요청의 검토자·승인자가 될 수 없다(SOD-13·14), 역할은 PLM 기준정보·구성 승인 계정이 맡는다', () => {
    const cr = { requestedBy: 'usr-author' };
    expect(refChangeDutyBlocker(cr, 'usr-author', 'REVIEW')).toMatch(/SOD-14/);
    expect(refChangeDutyBlocker(cr, 'usr-author', 'DECIDE')).toMatch(/SOD-13/);
    expect(refChangeDutyBlocker(cr, 'usr-steward', 'DECIDE')).toBeNull();
    expect(refChangeDutyBlocker(cr, 'usr-approver', 'REVIEW')).toBeNull();
    expect(SOD_RULES.filter((r) => r.id === 'SOD-13' || r.id === 'SOD-14').map((r) => r.subject)).toEqual(['Feature DB 변경 승인', 'Feature DB 변경 검토']);
    const holders = (r: Parameters<typeof dutiesOf>[0][number]) => Object.keys(DEMO_PERSONAS).filter((k) => DEMO_PERSONAS[k].includes(r));
    expect(holders('REFDB_ADMIN')).toEqual(['steward']);
    expect(holders('DOMAIN_REVIEWER')).toEqual(['approver']);
  });
});
