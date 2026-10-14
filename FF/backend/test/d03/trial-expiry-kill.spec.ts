// 체험권 만료 → 상업 사유 차단 (D03-03, 보고서 v1.1 FFG-LCY-010·FFG-DEAC-004·FFG-PLT-006) — 사용 권한 sweep(D01-05)과 나눈 계약:
// trial.expired 중 F2 이상은 kill_command v2 deactivate(COMMERCIAL/TRIAL_EXPIRED)로 — 만료 전 고지(noticeId)가 명령의 user_notice가 되고,
// 고지가 없으면 명령을 만들지 않는다(보고서 예제 expiry_without_notice = 게이트 FAIL). 발행은 2인 승인(시스템 요청자 제외).
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { TrialExpiryService } from '../../src/domains/d01-policy/entitlement/trial-expiry.service';
import { TrialExpiryListener } from '../../src/domains/d03-safety/kill-switch/trial-expiry.listener';
import { bootApp, KILL_APPROVERS } from '../helpers';

const kst = (ymd: string) => `${ymd}T01:00:00.000Z`;

describe('체험권 만료 → 상업 사유 차단 (FFG-LCY-010)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-12T01:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });

  it('고지 뒤 만료(ego-01 ENT-00001, FEAT-00022 F3) → 시스템이 COMMERCIAL/TRIAL_EXPIRED 차단 요청, 2인 승인 → 명령 user_notice = 고지 기록', async () => {
    const http = b.http;
    const clock = b.get(Clock);
    const sweep = b.get(TrialExpiryService);
    clock.set(kst('2026-10-27'));
    expect(sweep.sweep().notices.map((n) => n.noticeId)).toEqual(['NTC-00001']);
    clock.set(kst('2026-10-31'));
    expect(sweep.sweep().expired.map((e) => [e.grantId, e.noticeId])).toEqual([['ENT-00001', 'NTC-00001']]);
    const k = (await http().get('/api/kill-requests?status=REQUESTED').expect(200)).body.items.find((x: any) => x.reasonCode === 'TRIAL_EXPIRED');
    expect(k).toMatchObject({ featureId: 'FEAT-00022', vins: ['ego-01'], reasonCategory: 'COMMERCIAL', requestedBy: 'system', userNoticeRef: 'NTC-00001', fsmRequired: false });
    await http().post(`/api/kill-requests/${k.killId}/approvals`).set(KILL_APPROVERS[0]).send({}).expect(201);
    const done = (await http().post(`/api/kill-requests/${k.killId}/approvals`).set(KILL_APPROVERS[1]).send({}).expect(201)).body;
    expect(done.status).toBe('ACTIVE');
    const env = (await http().get(`/api/kill-requests/${k.killId}/envelopes`).expect(200)).body.envelopes[0];
    expect(env).toMatchObject({ request: 'deactivate', reason: { category: 'COMMERCIAL', code: 'TRIAL_EXPIRED' }, user_notice: { required: true, text_ref: 'NTC-00001' } });
    expect(done.gate.failed ?? []).toEqual([]);
  });

  it('고지 없는 만료는 차단 요청을 만들지 않는다 — 감사 FAILED·trial.expiry.blocked, F0·F1은 대상 아님', async () => {
    const http = b.http;
    const listener = b.get(TrialExpiryListener);
    const before = (await http().get('/api/kill-requests').expect(200)).body.items.length;
    const made = listener.onExpired({ grantId: 'ENT-09999', vin: 'lead-01', catalogId: 'CAT-00019', featureIds: ['FEAT-00022'], fClassMax: 'F3', validTo: '2026-10-30', noticeId: null, noticeAt: null, expiredAt: kst('2026-10-31') });
    expect(made).toEqual([]);
    expect((await http().get('/api/kill-requests').expect(200)).body.items).toHaveLength(before);
    const blocked = (await http().get('/api/events?type=trial.expiry.blocked').expect(200)).body.items;
    expect(blocked.at(-1).payload).toMatchObject({ grantId: 'ENT-09999', featureId: 'FEAT-00022', reason: 'NO_NOTICE' });
    const failed = (await http().get('/api/audit?target=FEAT-00022@1.0.0').expect(200)).body.items.filter((x: any) => x.action === 'TRIAL_EXPIRY_KILL' && x.result === 'FAILED');
    expect(failed.at(-1).reason ?? JSON.stringify(failed.at(-1))).toMatch(/고지 없음/);
    // F1 Feature(FEAT-00024)는 평가 변화만 — 요청·차단 없음
    expect(listener.onExpired({ grantId: 'ENT-09998', vin: 'lead-01', catalogId: 'CAT-X', featureIds: ['FEAT-00024'], fClassMax: 'F1', validTo: '2026-10-30', noticeId: null, noticeAt: null, expiredAt: kst('2026-10-31') })).toEqual([]);
  });
});
