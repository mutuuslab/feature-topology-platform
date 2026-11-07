// IAM 직무 분리 — FFG-PLT-016 합격: 겸직 계정 0건, 긴급 권한 사용 100%에 사후 검토 기록
import { describe, expect, it } from 'vitest';
import { SOD_RULES } from './access';
import { DEMO_PERSONAS, dutiesOf, dutyConflicts, postReviewBlocker, refChangeDuty, refChangeDutyBlocker } from './duty-separation';

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
    expect(holders('SAFETY_OFFICER')).toEqual(['quality', 'integrator', 'safety2']);
  });

  it('FFG-PLT-016 담당자 웨이브 데모 계정 — 운영 리더·두 번째 FSM·고객 출시 승인자가 따로 있고 각자 한 직무만', () => {
    const holders = (d: Parameters<typeof dutiesOf>[0][number]) => Object.keys(DEMO_PERSONAS).filter((k) => DEMO_PERSONAS[k].includes(d));
    expect(holders('OPS_LEAD')).toEqual(['opslead']);
    expect(holders('PRODUCT_APPROVER')).toEqual(['approver', 'productowner']);
    expect(dutiesOf(DEMO_PERSONAS.opslead)).toEqual(['KILL_EXECUTION']);
    expect(dutiesOf(DEMO_PERSONAS.safety2)).toEqual(['RESTORE_APPROVAL']);
    expect(dutiesOf(DEMO_PERSONAS.productowner)).toEqual(['REQUIREMENT_APPROVAL']);
    expect(Object.keys(DEMO_PERSONAS)).toHaveLength(13); // + 시스템 관리자 sysadmin(D-GAP-1)
  });

  it('FFG-PLT-016 긴급 권한 사후 검토자는 그 명령의 요청자·승인자가 아니다', () => {
    const cmd = { requestedBy: 'usr-ops', approvers: ['usr-safety', 'usr-opslead'] };
    expect(postReviewBlocker(cmd, 'usr-ops')).toMatch(/요청자/);
    expect(postReviewBlocker(cmd, 'usr-safety')).toMatch(/승인자/);
    expect(postReviewBlocker(cmd, 'usr-csm')).toBeNull();
  });

  it('Feature DB 변경 요청 — 요청자는 자기 요청의 검토자·승인자가 될 수 없다(SOD-13·14), 역할은 PLM 기준정보·구성 승인 계정이 맡는다', () => {
    const cr = { requestedBy: 'usr-author' };
    expect(refChangeDuty(cr, 'usr-author', 'REVIEW')).toEqual({ rule: 'SOD-14', message: '변경 요청자는 자기 요청을 검토할 수 없습니다' });
    expect(refChangeDuty(cr, 'usr-author', 'DECIDE')).toEqual({ rule: 'SOD-13', message: '변경 요청자는 자기 요청을 승인·반려할 수 없습니다' });
    expect(refChangeDutyBlocker(cr, 'usr-steward', 'DECIDE')).toBeNull();
    expect(refChangeDutyBlocker(cr, 'usr-approver', 'REVIEW')).toBeNull();
    expect(SOD_RULES.filter((r) => ['SOD-13', 'SOD-14', 'SOD-15'].includes(r.id)).map((r) => r.subject)).toEqual(['Feature DB 변경 승인', 'Feature DB 변경 검토', 'Feature DB 검토·승인 분리']);
    const holders = (r: Parameters<typeof dutiesOf>[0][number]) => Object.keys(DEMO_PERSONAS).filter((k) => DEMO_PERSONAS[k].includes(r));
    expect(holders('REFDB_ADMIN')).toEqual(['steward']);
    expect(holders('DOMAIN_REVIEWER')).toEqual(['approver']);
  });

  it('Feature DB 변경 요청 — 그 요청에 검토 의견을 낸 사람은 승인·반려할 수 없다(SOD-15, 계정 기준), 검토는 다시 낼 수 있다', () => {
    const cr = { requestedBy: 'usr-author', reviews: [{ reviewerId: 'usr-both' }] };
    expect(refChangeDuty(cr, 'usr-both', 'DECIDE')).toEqual({ rule: 'SOD-15', message: '이 요청에 검토 의견을 낸 사람은 승인·반려할 수 없습니다' });
    expect(refChangeDuty(cr, 'usr-both', 'REVIEW')).toBeNull();
    expect(refChangeDuty(cr, 'usr-steward', 'DECIDE')).toBeNull();
    expect(refChangeDuty({ ...cr, reviews: [] }, 'usr-both', 'DECIDE')).toBeNull();
  });

  it('직무 분리 사유 문구에는 규칙 ID가 없다 — 화면 버튼 이유로 그대로 보인다', () => {
    const cr = { requestedBy: 'usr-author', reviews: [{ reviewerId: 'usr-rev' }] };
    const messages = [refChangeDutyBlocker(cr, 'usr-author', 'REVIEW'), refChangeDutyBlocker(cr, 'usr-author', 'DECIDE'), refChangeDutyBlocker(cr, 'usr-rev', 'DECIDE')];
    for (const m of messages) {
      expect(m).toBeTruthy();
      expect(m).not.toMatch(/SOD-|FFG-|REFDB_|[()]/);
    }
  });
});
