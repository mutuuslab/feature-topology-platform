// EU Data Act 접근권 (D05-01, 보고서 v1.1 13.6 · FFG-TEL-006) — 합격: 요청 처리 절차와 계약 근거 문서가 있고, 표본 요청 처리 기록이 있다.
// 플랫폼 몫: 사용자·제3자 요청 판정과 Feature 상태·이력 제공, 처리 기록(제공·거부), 계약 근거 문서 ID 등록, Art.3(1) 직접 접근 대상 표시.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp } from '../helpers';

const OPS = actor('seo.ops', 'OPERATOR');
const REG = actor('usr-reg', 'REGULATORY_OWNER');
const EU_VIN = 'TMA-NX4-0001';

describe('EU Data Act 접근권 (FFG-TEL-006)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-15T01:00:00.000Z' });
  });
  afterAll(async () => b.app.close());

  it('FFG-TEL-006 처음에는 계약 근거·표본 처리 기록이 없다는 발견, EU 차량의 출시일이 없어 Art.3(1) 대상 판정 불가', async () => {
    const o = (await b.http().get('/api/data-access-requests').set(REG).expect(200)).body;
    expect(o.requests).toEqual([]);
    expect(o.findings).toEqual(expect.arrayContaining(['OEM의 비개인 데이터 이용 계약 근거가 등록되지 않았습니다(법무 검토 필요)', '표본 요청 처리 기록이 없습니다']));
    expect(o.vehicles).toEqual([
      { vin: 'TMA-NX4-0001', directAccess: 'UNKNOWN' },
      { vin: 'TMA-NX4-0002', directAccess: 'UNKNOWN' },
    ]);
  });

  it('FFG-TEL-006 EU 사용자 요청(Art.4) → Feature 상태·이력 제공, 처리 기록에는 해시와 건수만', async () => {
    const r = (await b.http().post('/api/data-access-requests').set(OPS).send({ vin: EU_VIN, requester: 'USER' }).expect(201)).body;
    expect(r).toMatchObject({ requestId: 'DAR-00001', status: 'FULFILLED', exportHash: expect.stringMatching(/^sha256:/), data: { vin: EU_VIN, featureState: expect.any(Array), statusHistory: expect.any(Array), commands: expect.any(Array) } });
    const rec = (await b.http().get('/api/data-access-requests').set(REG).expect(200)).body.requests[0];
    expect(rec).toMatchObject({ requestId: 'DAR-00001', vin: EU_VIN, status: 'FULFILLED', requester: 'USER', exportHash: r.exportHash, handledBy: 'seo.ops' });
    expect(rec).not.toHaveProperty('data');
  });

  it('FFG-TEL-006 제3자(Art.5) — 위임 근거 없거나 gatekeeper면 거부, 거부도 처리 기록 · EU 밖 차량은 절차 대상 아님', async () => {
    const http = b.http;
    const tp = { id: 'TP-REPAIR-01', name: '독립 정비사', gatekeeper: false };
    const noAuth = await http().post('/api/data-access-requests').set(OPS).send({ vin: EU_VIN, requester: 'THIRD_PARTY', thirdParty: tp }).expect(422);
    expect(noAuth.body.error.details.rejections.map((x: any) => x.code)).toEqual(['AUTHORIZATION_MISSING']);
    const gk = await http().post('/api/data-access-requests').set(OPS).send({ vin: EU_VIN, requester: 'THIRD_PARTY', thirdParty: { ...tp, id: 'TP-GK', name: 'Gatekeeper 플랫폼', gatekeeper: true }, userAuthorizationRef: 'CONSENT-0001' }).expect(422);
    expect(gk.body.error.details.rejections.map((x: any) => x.code)).toEqual(['GATEKEEPER']);
    await http().post('/api/data-access-requests').set(OPS).send({ vin: EU_VIN, requester: 'THIRD_PARTY', thirdParty: tp, userAuthorizationRef: 'CONSENT-0001', scope: ['FEATURE_STATE'] }).expect(201);
    const us = await http().post('/api/data-access-requests').set(OPS).send({ vin: 'HMA-NX4-0001', requester: 'USER' }).expect(422);
    expect(us.body.error.details.rejections.map((x: any) => x.code)).toEqual(['NOT_EU_VEHICLE']);
    const recs = (await http().get('/api/data-access-requests').set(REG).expect(200)).body.requests;
    expect(recs.map((x: any) => x.status).sort()).toEqual(['FULFILLED', 'FULFILLED', 'REJECTED', 'REJECTED', 'REJECTED']);
    // 처리 기록은 고칠 수 없다
    expect(() => b.get<Db>(DB).run('DELETE FROM data_access_request')).toThrow(/추가만/);
  });

  it('FFG-TEL-006 계약 근거는 법무만 등록하고, 등록되면 발견이 사라진다', async () => {
    const http = b.http;
    await http().post('/api/data-act/contract-basis').set(OPS).send({ ref: 'LEGAL-DA-2026-01', note: '비개인 데이터 이용 약관' }).expect(403);
    await http().post('/api/data-act/contract-basis').set(REG).send({ ref: 'LEGAL-DA-2026-01', note: '비개인 데이터 이용 약관(시험용 문서 ID)' }).expect(201);
    const o = (await http().get('/api/data-access-requests').set(REG).expect(200)).body;
    expect(o.contractBasis).toEqual([expect.objectContaining({ ref: 'LEGAL-DA-2026-01', recordedBy: 'usr-reg' })]);
    expect(o.findings.filter((f: string) => !f.includes('Art.3(1)'))).toEqual([]);
  });
});
