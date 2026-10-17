// 체험권 만료 사전 고지·만료 확정 sweep (D01-05, FFG-LCY-010) — 표준 세션 WP6과 나눈 계약:
//   trial.expiry.notice {grantId, vin, catalogId, featureIds, fClassMax, validTo, noticeId, noticeAt} — 만료 3일 전, 만료일마다 한 번
//   trial.expired       {…같은 키, expiredAt} — 만료일 다음 날, 고지가 없었으면 noticeId·noticeAt = null. 전환(CONVERTED)이면 내지 않는다
process.env.FF_SCHEDULER = 'manual';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { TrialExpiryService } from '../../src/domains/d01-policy/entitlement/trial-expiry.service';
import { actor, bootApp } from '../helpers';

const OPERATOR = actor('seo.ops', 'OPERATOR');
const PRODUCT = actor('park.product', 'PRODUCT_AUTHOR');
const AT = '2026-10-12T01:00:00.000Z'; // KST 2026-10-12 — 데모 ego-01 체험(ENT-00001)은 2026-10-30까지
const kst = (ymd: string) => `${ymd}T01:00:00.000Z`;

describe('체험권 만료 sweep — 사전 고지 → 만료 확정 (FFG-LCY-010)', () => {
  let app: INestApplication;
  let http: () => any;
  let sweep: TrialExpiryService;
  let clock: Clock;
  const events = async (type: string) => (await http().get(`/api/events?type=${type}`).expect(200)).body.items.map((e: any) => e.payload);
  const grant = async (vin: string, grantId: string) => (await http().get(`/api/entitlements?vin=${vin}`).expect(200)).body.items.find((g: any) => g.grantId === grantId);

  beforeAll(async () => {
    let get: <T>(t: any) => T;
    ({ app, http, get } = await bootApp({ at: AT }));
    sweep = get(TrialExpiryService);
    clock = get(Clock);
    clock.set(AT);
    // lead-01(ENT-00003) 수락 → 2026-11-10까지 · KMH-NX4-0003 제안(ENT-00008, 지원 차량), 10-14에 수락 → 2026-11-12까지
    await http().post('/api/trials/ENT-00003/accept').set(OPERATOR).send({}).expect(200);
    await http().post('/api/trials/offers').set(PRODUCT).send({ catalogId: 'CAT-00019', vins: ['KMH-NX4-0003'] }).expect(201);
    clock.set(kst('2026-10-14'));
    await http().post('/api/trials/ENT-00008/accept').set(OPERATOR).send({}).expect(200);
  });
  afterAll(() => app.close());

  it('시드 시점에 이미 끝난 체험(TMA-NX4-0001)은 만료 확정된 과거 기록 — sweep이 다시 내보내지 않는다', async () => {
    expect(await grant('TMA-NX4-0001', 'ENT-00007')).toMatchObject({ status: 'EXPIRED', state: 'EXPIRED' });
    clock.set(kst('2026-10-26'));
    expect(sweep.sweep()).toMatchObject({ today: '2026-10-26', notices: [], expired: [] });
  });

  it('만료 3일 전 — 고지 NTC-00001, 상품의 Feature·최고 안전 분류(FEAT-00022 F3)를 싣고, 같은 날 다시 돌려도 늘지 않는다', async () => {
    clock.set(kst('2026-10-27'));
    const r = sweep.sweep();
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toMatchObject({ grantId: 'ENT-00001', vin: 'ego-01', catalogId: 'CAT-00019', validTo: '2026-10-30', noticeId: 'NTC-00001', fClassMax: 'F3' });
    expect(r.notices[0].featureIds).toContain('FEAT-00022');
    expect(sweep.sweep()).toMatchObject({ notices: [], expired: [] });
    expect(await events('trial.expiry.notice')).toEqual([r.notices[0]]);
    expect(await grant('ego-01', 'ENT-00001')).toMatchObject({ noticeId: 'NTC-00001', noticeFor: '2026-10-30', state: 'ACTIVE', effective: true });
  });

  it('만료일 다음 날 — 저장 상태 EXPIRED 확정, 고지 ID를 그대로 싣는다 · 다른 체험은 고지만', async () => {
    clock.set(kst('2026-11-07'));
    const r = sweep.sweep();
    expect(r.expired.map((e) => [e.grantId, e.noticeId, e.fClassMax])).toEqual([['ENT-00001', 'NTC-00001', 'F3']]);
    expect(r.expired[0].noticeAt).toBeTruthy();
    expect(r.notices.map((n) => [n.grantId, n.noticeId, n.validTo])).toEqual([['ENT-00003', 'NTC-00002', '2026-11-10']]);
    expect(await grant('ego-01', 'ENT-00001')).toMatchObject({ status: 'EXPIRED', state: 'EXPIRED', effective: false });
    expect(sweep.sweep()).toMatchObject({ notices: [], expired: [] });
  });

  it('고지 뒤 구매로 전환한 체험은 만료를 내지 않고, 고지 없이 기간이 지난 체험은 noticeId·noticeAt = null로 낸다', async () => {
    await http().post('/api/trials/ENT-00003/purchase').set(OPERATOR).send({ plan: '구독' }).expect(200);
    clock.set(kst('2026-11-20')); // ENT-00008(11-12 만료)은 고지 기간(11-09~11-12)에 sweep이 없었다
    const r = sweep.sweep();
    expect(r.notices).toEqual([]);
    expect(r.expired.map((e) => [e.grantId, e.noticeId, e.noticeAt])).toEqual([['ENT-00008', null, null]]);
    const all = await events('trial.expired');
    expect(all.map((e: any) => e.grantId)).toEqual(['ENT-00001', 'ENT-00008']);
    expect(all[1]).toMatchObject({ vin: 'KMH-NX4-0003', validTo: '2026-11-12', fClassMax: 'F3' });
  });

  it('감사 기록 — 시스템 행위자로 고지·만료가 남는다', async () => {
    const a = (await http().get('/api/audit?target=ENT-00001').expect(200)).body.items.map((x: any) => [x.action, x.actorId]);
    expect(a).toEqual(expect.arrayContaining([['TRIAL_EXPIRY_NOTICE', 'system:trial-expiry'], ['TRIAL_EXPIRED', 'system:trial-expiry']]));
  });
});
