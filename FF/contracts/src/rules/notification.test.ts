// 수신자 지정 알림 규칙 — 이벤트마다 명세서가 요구하는 내용 항목·수신자·제외 계정을 고정한다.
import { describe, expect, it } from 'vitest';
import { accountKeys, accountOf, emailEnabled, NOTIFICATION_ACCOUNTS, NOTIFICATION_RULES, receives, type NotificationContext } from './notification';

const feature = { featureId: 'FEAT-00022', version: '1.0.0', name: '전방 거리 경고', ownerId: 'ADAS기획팀' };
const ev = (type: string, payload: Record<string, unknown>, aggregate = 'X'): NotificationContext['event'] => ({ seq: 1, type, at: '2026-10-17T01:00:00.000Z', aggregate, payload });
const kill = {
  killId: 'KILL-00001',
  featureId: 'FEAT-00022',
  featureIds: ['FEAT-00022'],
  flagKeys: ['care_00022_param'],
  vins: ['V1', 'V2'],
  reason: '현장 결함 확인',
  reasonCategory: 'SAFETY',
  reasonCode: 'FIELD_DEFECT',
  requestedBy: 'usr-operator',
  requestedAt: '2026-10-17T00:00:00.000Z',
  approvals: [{ approverId: 'usr-quality' }, { approverId: 'usr-coordinator' }],
  restoreRequest: { requestedBy: 'usr-operator', requestedAt: '2026-10-17T02:00:00.000Z', reason: '원인 조치 완료', approvals: [] },
};
const build = (type: string, ctx: Omit<NotificationContext, 'event'> & { payload?: Record<string, unknown>; aggregate?: string }) => NOTIFICATION_RULES[type].build({ ...ctx, event: ev(type, ctx.payload ?? {}, ctx.aggregate) });
const labels = (d: ReturnType<typeof build>) => d!.fields.map((f) => f.label);
const who = (d: ReturnType<typeof build>) => NOTIFICATION_ACCOUNTS.filter((a) => receives(d!, a)).map((a) => a.id);

describe('알림 규칙 — 내용 항목과 수신자', () => {
  it('Gate 판정 → Feature Owner 팀과 Feature 승인자, 판정한 본인은 빼고', () => {
    const d = build('gate.judged', { feature, aggregate: 'FEAT-00022@1.0.0', payload: { gate: 'G3', status: 'FAIL', by: 'usr-quality' } });
    expect(d).toMatchObject({ category: 'GATE', severity: 'WARNING', link: '/features/FEAT-00022/1.0.0?tab=gates', requirementIds: ['FR-REG-005-014'] });
    expect(d!.recipients).toEqual([{ kind: 'team', team: 'ADAS기획팀' }, { kind: 'role', role: 'FEATURE_APPROVER' }]);
    expect(who(d)).toEqual(['usr-author', 'usr-approver']);
  });

  it('검증 NO-GO → 배포 차단·게이트 실패 알림(배포 대상·Feature·실패 항목·사유), Owner와 배포 요청자', () => {
    const policy = { policyId: 'POL-00009', flagKey: 'care_00022_param', controlPoint: 'Parameter', featureId: 'FEAT-00022', featureVersion: '1.0.0', createdBy: 'usr-commerce', approvedBy: null };
    const d = build('policy.validated', { feature, policy, payload: { runId: 'VAL-00003', decision: 'NO_GO', results: [{ componentId: 'D06-03', result: 'FAIL' }, { componentId: 'D06-01', result: 'PASS' }] } });
    expect(d).toMatchObject({ category: 'DEPLOY', severity: 'WARNING', requirementIds: ['FR-CRC-002-009', 'FR-DSV-001-011'] });
    expect(labels(d)).toEqual(['배포 대상 정책', 'Feature', '실패 항목', '차단 사유']);
    expect(d!.fields[2].value).toBe('D06-03 FAIL');
    expect(who(d)).toEqual(['usr-author', 'usr-commerce']);
    // GO는 승인 요청 — 작성자 본인은 승인 대상이 아니다
    const go = build('policy.validated', { feature, policy: { ...policy, createdBy: 'usr-approver' }, payload: { runId: 'VAL-00004', decision: 'GO', results: [] } });
    expect(go).toMatchObject({ category: 'APPROVAL' });
    expect(who(go)).toEqual([]);
  });

  it('긴급 차단 실행 → Feature·차단 대상 범위·차단 사유, Owner·운영 담당자', () => {
    const d = build('kill.issued', { feature, kill, payload: { commandId: 'CMD-1' } });
    expect(d).toMatchObject({ category: 'SAFETY', severity: 'CRITICAL', requirementIds: ['FR-KSW-003-003'] });
    expect(d!.fields.slice(0, 3)).toEqual([
      { label: 'Feature', value: 'FEAT-00022 전방 거리 경고' },
      { label: '차단 대상 범위', value: '차량 2대 · flag care_00022_param' },
      { label: '차단 사유', value: 'SAFETY/FIELD_DEFECT — 현장 결함 확인' },
    ]);
    expect(who(d)).toEqual(['usr-author', 'usr-operator', 'usr-coordinator']);
  });

  it('복원 승인 요청 → 해제 범위·사유·요청자·일시, 승인 역할 중 요청자와 직전 차단 승인자는 빼고(SOD-09)', () => {
    const d = build('kill.restore-requested', { feature, kill });
    expect(labels(d)).toEqual(['Feature', '해제 대상 범위', '해제 사유', '요청자', '요청 일시']);
    expect(d!.exclude).toEqual(['usr-operator', 'usr-quality', 'usr-coordinator']);
    // 남는 승인 대상: PLM 기준정보(부 FSM)·시스템 연계(CSM)·구성 승인(Product 승인)
    expect(who(d)).toEqual(['usr-approver', 'usr-steward', 'usr-integrator']);
  });

  it('긴급 차단 요청 → 승인 역할 전원에게(요청자 제외), 이상 징후 CRITICAL은 FSM까지', () => {
    expect(who(build('kill.requested', { feature, kill }))).not.toContain('usr-operator');
    const a = build('anomaly.opened', { feature, payload: { anomalyId: 'ANM-00001', kind: 'FEATURE_FAULT', featureId: 'FEAT-00022', severity: 'CRITICAL', advice: 'KILL', vins: 3, signals: 5 } });
    expect(a).toMatchObject({ category: 'OPS', severity: 'CRITICAL', link: '/ops/anomalies?id=ANM-00001', requirementIds: ['FR-EVT-003-003'] });
    expect(a!.fields.find((f) => f.label === '발생 건수')!.value).toBe('신호 5건 · 차량 3대');
    expect(who(a)).toContain('usr-quality');
  });

  it('동기화는 실패일 때만 — 실패 유형·발생 시점·대상 외부 시스템, 연계 담당자', () => {
    expect(build('sync.completed', { payload: { status: 'SUCCEEDED', targetId: 'T1', ifId: 'IF-02' } })).toBeNull();
    const d = build('sync.completed', { payload: { status: 'FAILED', reason: 'timeout', targetId: 'SYNC-MDM', ifId: 'IF-03', market: 'KR' } });
    expect(labels(d)).toEqual(['실패 유형', '발생 시점', '대상 외부 시스템']);
    expect(who(d)).toEqual(['usr-integrator']);
  });
});

describe('수신 계정·이메일', () => {
  it('계정 키 — 개인·역할·팀(Feature 설계 계정은 모든 Owner 팀)', () => {
    expect(accountKeys(accountOf('usr-author'))).toEqual(['user:usr-author', 'role:FEATURE_AUTHOR', 'team:*']);
    expect(accountOf('someone', 'OPERATOR').roles).toEqual(['OPERATOR']);
  });

  it('승인 요청·긴급은 이메일을 끌 수 없고, 나머지는 범주별 설정(기본값)', () => {
    expect(emailEnabled({ category: 'APPROVAL', severity: 'INFO' }, { APPROVAL: false })).toBe(true);
    expect(emailEnabled({ category: 'OPS', severity: 'CRITICAL' }, { OPS: false })).toBe(true);
    expect(emailEnabled({ category: 'GATE', severity: 'INFO' }, null)).toBe(false);
    expect(emailEnabled({ category: 'GATE', severity: 'INFO' }, { GATE: true })).toBe(true);
  });
});
