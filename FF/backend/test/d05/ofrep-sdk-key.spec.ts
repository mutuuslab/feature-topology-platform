// OFREP SDK 키(2026-11-07 결정 C8 (b), FR-AGW-001-003 연계) — OFREP 평가 경로는 SDK 키가 필수다(Authorization: Bearer 또는 X-Api-Key).
// 키는 외부 API 키(발급·해시·폐기·만료)를 그대로 쓰고, 데모 인증 방식에는 공개 기본 키(AK-0000)가 있다. 키 없음·틀림·폐기는 401(OFREP 오류 본문)·감사 DENIED.
import { INestApplication } from '@nestjs/common';
import { DEMO_SDK_KEY } from '@ff/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp, SDK_KEY } from '../helpers';

const CSM = actor('usr-csm', 'SECURITY_OFFICER');
const FLAG = 'ivi_00024_guide';
const BODY = { context: { targetingKey: 'ego-01' } };

describe('OFREP SDK 키 필수', () => {
  let app: INestApplication;
  let http: () => any;
  let get: <T>(t: any) => T;
  beforeAll(async () => ({ app, http, get } = await bootApp({ at: '2026-11-07T01:00:00.000Z' })));
  afterAll(() => app.close());

  it('키가 없으면 401 — OFREP 오류 본문, 감사 DENIED(익명 SDK)', async () => {
    const one = await http().post(`/ofrep/v1/evaluate/flags/${FLAG}`).send(BODY).expect(401);
    expect(one.body).toMatchObject({ errorCode: 'UNAUTHENTICATED', errorDetails: expect.stringContaining('Bearer') });
    await http().post('/ofrep/v1/evaluate/flags').send(BODY).expect(401);
    const denied = get<Db>(DB).all<{ actor_id: string; result: string }>("SELECT actor_id, result FROM audit WHERE result = 'DENIED' AND target LIKE '/ofrep/%'");
    expect(denied.length).toBeGreaterThanOrEqual(2);
    expect(denied[0].actor_id).toBe('anonymous-sdk');
  });

  it('틀린 키·Bearer가 아닌 방식은 401', async () => {
    await http().post(`/ofrep/v1/evaluate/flags/${FLAG}`).set({ Authorization: `Bearer ${DEMO_SDK_KEY.slice(0, -1)}1` }).send(BODY).expect(401);
    await http().post(`/ofrep/v1/evaluate/flags/${FLAG}`).set({ Authorization: `Basic ${DEMO_SDK_KEY}` }).send(BODY).expect(401);
    await http().post(`/ofrep/v1/evaluate/flags/${FLAG}`).set({ Authorization: 'Bearer not-a-key' }).send(BODY).expect(401);
  });

  it('데모 기본 키(Bearer)로 평가된다 — 키 목록에 데모 기본 키가 보이고 마지막 사용이 남는다', async () => {
    const r = await http().post(`/ofrep/v1/evaluate/flags/${FLAG}`).set(SDK_KEY).send(BODY).expect(200);
    expect(r.body).toMatchObject({ key: FLAG, reason: 'TARGETING_MATCH' });
    await http().post('/ofrep/v1/evaluate/flags').set(SDK_KEY).send(BODY).expect(200);
    const keys = (await http().get('/api/api-keys').expect(200)).body.items;
    expect(keys.find((k: any) => k.keyId === 'AK-0000')).toMatchObject({ state: 'ACTIVE', role: 'AUDITOR', lastUsedAt: '2026-11-07T01:00:00.000Z' });
  });

  it('보안 담당이 발급한 키도 Bearer·X-Api-Key로 쓰이고, 폐기하면 401', async () => {
    const k = (await http().post('/api/api-keys').set(CSM).send({ name: 'IVI 앱 SDK', system: 'IVI 내비 앱', role: 'AUDITOR', reason: 'OFREP 평가' }).expect(201)).body;
    await http().post(`/ofrep/v1/evaluate/flags/${FLAG}`).set({ Authorization: `Bearer ${k.secret}` }).send(BODY).expect(200);
    await http().post(`/ofrep/v1/evaluate/flags/${FLAG}`).set({ 'X-Api-Key': k.secret }).send(BODY).expect(200);
    await http().delete(`/api/api-keys/${k.keyId}`).set(CSM).send({ reason: '앱 교체' }).expect(200);
    const r = await http().post(`/ofrep/v1/evaluate/flags/${FLAG}`).set({ Authorization: `Bearer ${k.secret}` }).send(BODY).expect(401);
    expect(r.body.errorCode).toBe('UNAUTHENTICATED');
  });

  it('데모 기본 키를 폐기하면 다시 부팅해도 되살리지 않는다', async () => {
    await http().delete('/api/api-keys/AK-0000').set(CSM).send({ reason: '공개 키 사용 중지' }).expect(200);
    await http().post(`/ofrep/v1/evaluate/flags/${FLAG}`).set(SDK_KEY).send(BODY).expect(401);
    const { DemoSdkKeySeeder } = await import('../../src/domains/d05-ext/api-gateway/ofrep-sdk-key');
    app.get(DemoSdkKeySeeder).onApplicationBootstrap();
    await http().post(`/ofrep/v1/evaluate/flags/${FLAG}`).set(SDK_KEY).send(BODY).expect(401);
  });
});
