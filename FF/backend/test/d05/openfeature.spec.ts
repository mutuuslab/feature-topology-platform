// OF-1 공식 OpenFeature SDK 적합성 — @openfeature/server-sdk + @openfeature/ofrep-provider가 FF 백엔드(IF-10 OFREP)에 붙어
// 값·variant·reason·flagMetadata를 받고, 오류(없는 flag·문맥 누락·미등록 차량)는 SDK 기본값(= 앱이 넘긴 Safe Default)으로 떨어지는지.
// OF-4 문맥: targetingKey = VIN. 국가·차종 같은 속성은 등록 정보(신뢰 원천)를 쓰고, SDK가 보낸 값이 다르면 metadata에 무시 사실을 남긴다.
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { ErrorCode, OpenFeature, type Client } from '@openfeature/server-sdk';
import { OFREPProvider } from '@openfeature/ofrep-provider';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp } from '../helpers';

const FLAG = 'care_00022_param';

describe('OpenFeature SDK ↔ FF OFREP (OF-1·OF-4)', () => {
  let app: INestApplication;
  let http: () => any;
  let client: Client;
  beforeAll(async () => {
    process.env.GLEO_MODE = 'internal';
    ({ app, http } = await bootApp());
    app.get(Clock).set('2026-10-12T01:00:00.000Z');
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    await OpenFeature.setProviderAndWait('ff', new OFREPProvider({ baseUrl: `http://127.0.0.1:${port}` }));
    client = OpenFeature.getClient('ff');
  });
  afterAll(async () => {
    await OpenFeature.close();
    await app.close();
    delete process.env.GLEO_MODE;
  });

  it('ego-01: ON · variant on · TARGETING_MATCH · flagMetadata에 정책·개정·결정', async () => {
    const d = await client.getBooleanDetails(FLAG, false, { targetingKey: 'ego-01' });
    expect(d).toMatchObject({ value: true, variant: 'on', reason: 'TARGETING_MATCH' });
    expect(d.errorCode).toBeUndefined();
    expect(d.flagMetadata).toMatchObject({ policyId: 'POL-00002', revision: 1, decision: 'ALLOW', platformReason: 'POLICY_MATCH' });
  });

  it('권한 없는 차량(KMH-NX4-0002): OFF · DEFAULT — 기본값이 아니라 FF가 판단한 값', async () => {
    const d = await client.getBooleanDetails(FLAG, true, { targetingKey: 'KMH-NX4-0002' });
    expect(d).toMatchObject({ value: false, reason: 'DEFAULT' });
    expect(d.flagMetadata.platformReason).toBe('NO_ENTITLEMENT');
  });

  it('문맥 품질 불명(STALE 차량): Safe Default · UNKNOWN', async () => {
    const d = await client.getBooleanDetails(FLAG, true, { targetingKey: 'KMH-NX4-0003' });
    expect(d).toMatchObject({ value: false, reason: 'UNKNOWN' });
    expect(d.flagMetadata.decision).toBe('HOLD');
  });

  it.each([
    ['없는 flag', 'nope_flag', { targetingKey: 'ego-01' }, ErrorCode.FLAG_NOT_FOUND],
    ['targetingKey 누락', FLAG, {}, ErrorCode.TARGETING_KEY_MISSING],
    ['미등록 차량', FLAG, { targetingKey: 'NOPE-1' }, ErrorCode.INVALID_CONTEXT],
  ])('%s → SDK는 앱이 넘긴 기본값(Safe Default)과 오류 코드', async (_n, key, ctx, code) => {
    const d = await client.getBooleanDetails(key, false, ctx);
    expect(d).toMatchObject({ value: false, reason: 'ERROR', errorCode: code });
  });

  it('긴급 차단 중이면 SDK도 Safe Default(DISABLED) — 해제하면 다시 ON', async () => {
    const ops = actor('seo.ops', 'OPERATOR');
    const k = await http().post('/api/kill-requests').set(ops).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], safeMode: 'SAFE_DEFAULT', reason: 'SDK 확인', confirm: 'FEAT-00022' }).expect(201);
    const killed = await client.getBooleanDetails(FLAG, true, { targetingKey: 'ego-01' });
    expect(killed).toMatchObject({ value: false, reason: 'DISABLED' });
    expect(killed.flagMetadata.platformReason).toBe('KILL_SWITCH');
    await http().post(`/api/kill-requests/${k.body.killId}/release`).set(ops).send({ reason: '복구' }).expect(200);
    expect((await client.getBooleanDetails(FLAG, false, { targetingKey: 'ego-01' })).value).toBe(true);
  });

  it('OF-4: SDK가 보낸 속성이 등록 정보와 다르면 등록 정보를 쓰고 무시한 속성을 알린다', async () => {
    const d = await client.getBooleanDetails(FLAG, false, { targetingKey: 'ego-01', country: 'US', vehicleTrim: 'Premium' });
    expect(d.value).toBe(true);
    expect(d.flagMetadata).toMatchObject({ contextSource: 'REGISTRY', ignoredContext: 'country' });
  });
});
