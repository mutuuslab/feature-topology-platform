// 관제 담당자 웨이브 W1 — 알림 수신자(P4-1·P4-6)·장애 접수 차량 범위(P4-8) 규칙
import { describe, expect, it } from 'vitest';
import { incidentVehicleScope } from './ext';
import { NOTIFICATION_ACCOUNTS, NOTIFICATION_RULES, receives, type NotificationContext } from './notification';

const ctx = (type: string, payload: Record<string, unknown>, kill?: NotificationContext['kill']): NotificationContext => ({
  event: { seq: 1, type, at: '2026-11-05T00:00:00.000Z', aggregate: String(payload.killId ?? payload.keyId ?? 'x'), payload },
  feature: { featureId: 'FEAT-00022', version: '1.0.0', name: '전방 안전거리 3단계', ownerId: 'ADAS상품기획팀' },
  kill,
});
const who = (n: ReturnType<(typeof NOTIFICATION_RULES)[string]['build']>) => NOTIFICATION_ACCOUNTS.filter((a) => receives(n!, a)).map((a) => a.id).sort();
const KILL = { killId: 'KILL-00001', featureId: 'FEAT-00022', featureIds: ['FEAT-00022'], flagKeys: [], vins: ['ego-01'], reason: 'r', reasonCategory: 'SAFETY', reasonCode: 'FIELD_FAULT', requestedBy: 'usr-operator', requestedAt: 'x', approvals: [] };

describe('관제 알림 수신자', () => {
  it('F2 이상 안전 차단 승인 요청은 FSM·CSM만 — 운영 리더·상품·법규 계정에게 "내 차례"를 보내지 않는다, 상업 사유는 승인 역할 모두', () => {
    const safety = NOTIFICATION_RULES['kill.requested'].build(ctx('kill.requested', { killId: 'KILL-00001', fsmRequired: true }, KILL));
    expect(who(safety)).toEqual(['usr-integrator', 'usr-quality', 'usr-safety2']);
    const commercial = NOTIFICATION_RULES['kill.requested'].build(ctx('kill.requested', { killId: 'KILL-00001', fsmRequired: false }, KILL));
    expect(who(commercial)).toEqual(expect.arrayContaining(['usr-opslead', 'usr-approver']));
  });
  it('복원 승인자 부족 경보 → 운영 리더·Safety Manager, 없는 역할은 업무 이름으로', () => {
    const n = NOTIFICATION_RULES['kill.restore-blocked'].build(ctx('kill.restore-blocked', { killId: 'KILL-00001', featureId: 'FEAT-00022', missing: ['FSM'], excluded: ['usr-quality', 'usr-integrator'] }));
    expect(n).toMatchObject({ category: 'SAFETY', severity: 'WARNING', link: '/ops/kill?id=KILL-00001' });
    expect(n!.fields.find((f) => f.label === '없는 승인')!.value).toBe('기능안전(Safety Manager)');
    expect(who(n)).toEqual(expect.arrayContaining(['usr-opslead', 'usr-safety2', 'usr-quality']));
  });
  it('서명 키 교체 → 품질·운영 담당(교체자 제외), 이전 키는 검증 전용으로 알린다', () => {
    const n = NOTIFICATION_RULES['pki.key.rotated'].build(ctx('pki.key.rotated', { keyId: 'KEY-0005', purpose: 'kill', retired: 'KEY-0003', by: 'usr-integrator', reason: '정기' }));
    expect(n!.title).toBe('서명 키 교체 — 긴급 차단 키 KEY-0005');
    expect(n!.fields.find((f) => f.label === '이전 키')!.value).toContain('검증 전용');
    const ids = who(n);
    expect(ids).toEqual(expect.arrayContaining(['usr-quality', 'usr-operator']));
    expect(ids).not.toContain('usr-integrator');
  });
});

describe('장애 접수 차량 ↔ Feature 적용 범위 (P4-8)', () => {
  const scopes = [{ version: '1.0.0', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }];
  it('범위 안·밖·등록 안 된 차량을 구분한다', () => {
    expect(incidentVehicleScope('ego-01', 'FEAT-00022', { country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium' }, scopes).fit).toBe('IN_SCOPE');
    const out = incidentVehicleScope('HMA-NX4-0001', 'FEAT-00022', { country: 'US', vehicleModel: 'NX4 PE', trim: 'Limited' }, scopes);
    expect(out).toMatchObject({ fit: 'OUT_OF_SCOPE' });
    expect(out.message).toContain('적용 범위가 아닙니다');
    expect(incidentVehicleScope('NOPE', 'FEAT-00022', null, scopes).fit).toBe('UNKNOWN_VEHICLE');
  });
});
