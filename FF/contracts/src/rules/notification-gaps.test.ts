// 수신자 지정 알림 보강(기능명세서 B1) — 충돌·품질 Gate·배포 중단·파이프라인·Legacy·과금 오류, 직접 보낸 알림, 수신자 규칙 표.
import { describe, expect, it } from 'vitest';
import { KILL_APPROVER_ROLES } from './access';
import { NOTIFICATION_ACCOUNTS, NOTIFICATION_RULES, receives, type NotificationContext } from './notification';
import { NOTIFICATION_SENT_EVENT } from './notification-keys';
import { KILL_APPROVER_SPEC, NOTIFICATION_RULE_SPECS, NotificationRuleBody, NotificationSendBody, recipientLabel, recipientTokenLabel } from './notification-rules';

const feature = { featureId: 'FEAT-00022', version: '1.0.0', name: '전방 거리 경고', ownerId: 'ADAS기획팀' };
const policy = { policyId: 'POL-00009', flagKey: 'care_00022_param', controlPoint: 'Parameter', featureId: 'FEAT-00022', featureVersion: '1.0.0', createdBy: 'usr-commerce', approvedBy: 'usr-approver', deployedBy: 'usr-operator' };
const ev = (type: string, payload: Record<string, unknown>, aggregate = 'X'): NotificationContext['event'] => ({ seq: 1, type, at: '2026-11-06T01:00:00.000Z', aggregate, payload });
const build = (type: string, ctx: Omit<NotificationContext, 'event'> & { payload?: Record<string, unknown> }) => NOTIFICATION_RULES[type].build({ ...ctx, event: ev(type, ctx.payload ?? {}) });
const labels = (d: ReturnType<typeof build>) => d!.fields.map((f) => f.label);
const who = (d: ReturnType<typeof build>) => NOTIFICATION_ACCOUNTS.filter((a) => receives(d!, a)).map((a) => a.id).sort();

describe('수신자 지정 알림 — 명세서 공백 7건', () => {
  it('FR-CON-001-003 충돌 탐지 → 정책 Owner 팀·관리자(정책 승인)·작성자, 충돌 내용 포함', () => {
    const d = build('policy.conflict.detected', { feature, policy, payload: { runId: 'VAL-00004', conflicts: ['flagKey care_00022_param를 FEAT-00001의 POL-00002가 이미 씁니다'] } });
    expect(d).toMatchObject({ category: 'DEPLOY', severity: 'WARNING', link: '/policies/POL-00009', requirementIds: ['FR-CON-001-003'] });
    expect(labels(d)).toEqual(['정책', 'Feature', '충돌 내용', '탐지 시점', '검증 실행']);
    expect(d!.fields[2].value).toContain('이미 씁니다');
    expect(who(d)).toEqual(['usr-approver', 'usr-author', 'usr-commerce']);
  });

  it('FR-QGV-003-005 품질 Gate 실패 → 산출물 ID·실패 항목·사유, Owner 팀·Gate 판정·작성자', () => {
    const d = build('quality.gate.failed', { feature, policy, payload: { runId: 'VAL-00004', revision: 3, contentHash: 'abcdef0123456789', result: 'FAIL', reasons: ['TMS 시험 결과 없음'] } });
    expect(d).toMatchObject({ category: 'GATE', requirementIds: ['FR-QGV-003-005'] });
    expect(labels(d)).toEqual(['산출물', 'Feature', '실패 항목', '실패 사유']);
    expect(d!.fields[0].value).toBe('정책 POL-00009 r3 · 내용 해시 abcdef012345');
    expect(d!.fields[3].value).toBe('TMS 시험 결과 없음');
    expect(who(d)).toEqual(['usr-author', 'usr-commerce', 'usr-quality']);
  });

  it('FR-DSV-003-005 배포 중단 필요 → 배포 ID·Feature ID·중단 사유, Owner 팀·배포 요청자(배포자)·확대 요청자', () => {
    const d = build('rollout.halt-required', { feature, policy, payload: { current: 500, to: 2500, reasons: ['열린 이상 징후 ANM-00003'], requestedBy: 'usr-coordinator' } });
    expect(d).toMatchObject({ category: 'DEPLOY', severity: 'CRITICAL', requirementIds: ['FR-DSV-003-005'] });
    expect(d!.fields[0].value).toBe('POL-00009 · care_00022_param · 현재 5%');
    expect(d!.fields[1].value).toContain('FEAT-00022');
    expect(d!.fields[2].value).toBe('열린 이상 징후 ANM-00003');
    expect(who(d)).toEqual(['usr-author', 'usr-coordinator', 'usr-operator']);
  });

  it('FR-CICD-001-006 파이프라인 실패 → 실행 ID·실패 단계·사유, 구현·출시 담당(+ Owner 팀)', () => {
    const d = build('pipeline.run.failed', { feature, payload: { runId: 'GL-4411', pipeline: 'ivi-app/main', environment: 'staging', stage: 'integration-test', reason: 'HIL 시험 3건 실패', featureId: 'FEAT-00022' } });
    expect(d).toMatchObject({ category: 'INTEGRATION', requirementIds: ['FR-CICD-001-006'] });
    expect(labels(d)).toEqual(['실행', '실패 단계', '실패 사유', 'Feature', '발생 시점']);
    expect(who(d)).toEqual(['usr-author', 'usr-coordinator', 'usr-integrator']);
  });

  it('FR-LGCY-001-008·FR-BIL-001-004 연계·과금 오류 → 오류 유형·발생 시점·대상 시스템·내용', () => {
    const lg = build('legacy.import.failed', { payload: { system: 'LEGACY', systemName: 'Legacy 연계(해외공장 ERP)', errorType: 'CONNECTION_OFF', target: 'CZ-01', at: '2026-11-06T00:59:00.000Z', message: 'IF-12 연계가 꺼져 있습니다' } });
    expect(lg).toMatchObject({ category: 'INTEGRATION', requirementIds: ['FR-LGCY-001-008'] });
    expect(labels(lg)).toEqual(['오류 유형', '발생 시점', '대상 시스템', '오류 내용']);
    expect(lg!.fields[1].value).toBe('2026-11-06T00:59:00.000Z');
    expect(who(lg)).toEqual(['usr-integrator', 'usr-operator']);
    const bl = build('billing.call.failed', { payload: { system: 'BILLING', systemName: '과금 시스템', errorType: 'CONNECTION_OFF', target: 'GRT-00001:구독', message: '과금 시스템 연결이 꺼져 있습니다' } });
    expect(bl).toMatchObject({ requirementIds: ['FR-BIL-001-004'] });
    expect(who(bl)).toEqual(['usr-commerce', 'usr-operator']);
  });

  it('직접 보낸 알림 — 고른 사람·역할·팀이 받고 보낸 사람은 빠진다. 잘못된 수신자는 버린다', () => {
    const d = build(NOTIFICATION_SENT_EVENT, { payload: { title: '점검 안내', message: '오늘 22시 Edge 점검', sentBy: 'usr-opslead', recipients: [{ kind: 'user', id: 'usr-integrator' }, { kind: 'role', role: 'OPS_LEAD' }, { kind: 'team', team: 'ADAS기획팀' }, { kind: 'role', role: 'NOPE' }], link: 'https://evil' } });
    expect(d).toMatchObject({ category: 'DIRECT', severity: 'INFO', link: '/notifications' });
    expect(d!.recipients).toHaveLength(3);
    expect(who(d)).toEqual(['usr-author', 'usr-integrator']);
    expect(build(NOTIFICATION_SENT_EVENT, { payload: { title: 'x', recipients: [] } })).toBeNull();
  });
});

describe('수신자 규칙 표', () => {
  it('알림 규칙표와 같은 이벤트를 모두 설명한다(빠짐·남음 없음)', () => {
    expect(NOTIFICATION_RULE_SPECS.map((s) => s.event).sort()).toEqual(Object.keys(NOTIFICATION_RULES).sort());
  });
  it('긴급 차단 승인 역할 값이 access와 같다', () => {
    expect([...KILL_APPROVER_SPEC].sort()).toEqual([...KILL_APPROVER_ROLES].sort());
  });
  it('수신자 이름 — 규칙 토큰·역할·저장 수신자', () => {
    expect(recipientTokenLabel('OWNER_TEAM')).toBe('Feature Owner 팀');
    expect(recipientTokenLabel('OPERATOR')).toBe('운영자');
    expect(recipientLabel({ kind: 'team', team: 'ADAS기획팀' })).toBe('ADAS기획팀 팀');
  });
  it('본문 — 추가 수신자 20명 상한·사유 필수, 직접 보내기 수신자 1명 이상·앱 안 링크만', () => {
    expect(NotificationRuleBody.safeParse({ recipients: [], reason: '정리' }).success).toBe(true);
    expect(NotificationRuleBody.safeParse({ recipients: [], reason: '' }).success).toBe(false);
    expect(NotificationSendBody.safeParse({ title: '안내', message: '내용입니다', recipients: [] }).success).toBe(false);
    expect(NotificationSendBody.safeParse({ title: '안내', message: '내용입니다', recipients: [{ kind: 'role', role: 'OPERATOR' }], link: 'https://x' }).success).toBe(false);
    expect(NotificationSendBody.parse({ title: '안내', message: '내용입니다', recipients: [{ kind: 'role', role: 'OPERATOR' }] }).severity).toBe('INFO');
  });
});

describe('하네스 리뷰 — 직접 보내기·수신자 규칙 결함', () => {
  const base = { title: '안내', message: '내용입니다', recipients: [{ kind: 'role', role: 'OPERATOR' }] };
  it('링크 — 다른 사이트로 읽히는 주소(//·/\\·제어 글자)는 거부한다(열린 리다이렉트)', async () => {
    const { isAppPath } = await import('./notification-keys');
    for (const link of ['//evil.example/x', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', '/a\\b'])
      expect(NotificationSendBody.safeParse({ ...base, link }).success, JSON.stringify(link)).toBe(false);
    expect(NotificationSendBody.safeParse({ ...base, link: '/ops/kill?tab=a#x' }).success).toBe(true);
    expect(isAppPath('/policies/POL-1')).toBe(true);
    expect(isAppPath('//evil.example')).toBe(false);
  });
  it('저장된 예전 알림의 링크도 앱 밖이면 알림함으로 바꾼다', () => {
    for (const link of ['//evil.example', '/\\evil.example'])
      expect(build(NOTIFICATION_SENT_EVENT, { payload: { title: '점검', message: 'x', sentBy: 'usr-opslead', recipients: [{ kind: 'role', role: 'OPERATOR' }], link } })!.link).toBe('/notifications');
  });
  it('수신자 역할은 사람 역할만(차량·시스템 역할은 아무도 받지 않는다)', () => {
    expect(NotificationSendBody.safeParse({ ...base, recipients: [{ kind: 'role', role: 'VEHICLE' }] }).success).toBe(false);
    expect(NotificationRuleBody.safeParse({ recipients: [{ kind: 'role', role: 'SYSTEM' }], reason: '시험' }).success).toBe(false);
  });
  it('직접 보낸 알림은 추가 수신자 규칙을 둘 수 없다(남의 직접 알림을 몰래 받아 보는 것 차단)', () => {
    expect(NOTIFICATION_RULE_SPECS.find((s) => s.event === NOTIFICATION_SENT_EVENT)?.fixed).toBe(true);
    expect(NOTIFICATION_RULE_SPECS.filter((s) => s.fixed).map((s) => s.event)).toEqual([NOTIFICATION_SENT_EVENT]);
  });
});

describe('알림 이벤트 목록(상단바 종 구독)', () => {
  it('규칙표의 이벤트와 같다 — 규칙을 더하면 목록에도 더한다', async () => {
    const { NOTIFICATION_EVENT_TYPES } = await import('./notification-keys');
    expect([...NOTIFICATION_EVENT_TYPES].sort()).toEqual(Object.keys(NOTIFICATION_RULES).sort());
  });
});
