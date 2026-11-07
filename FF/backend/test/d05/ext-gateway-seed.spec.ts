// P2 데모 시드(ext-gateway.seed.ts) — 데모 화면이 비지 않게: API 키·연계 설정·변환 규칙·메시지 변환·정산 전송이 실제 경로로 들어간다. 한 번만.
Object.assign(process.env, { FF_SCHEDULER: 'manual' });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExtGatewaySeeder } from '../../src/domains/d05-ext/ext-gateway.seed';
import { bootApp } from '../helpers';

afterAll(() => {
  delete process.env.FF_SCHEDULER;
});

describe('P2 데모 시드', () => {
  let app: INestApplication;
  let http: () => any;
  let get: <T>(t: any) => T;
  beforeAll(async () => ({ app, http, get } = await bootApp({ at: '2026-11-07T01:00:00.000Z', demoActivity: true })));
  afterAll(() => app.close());

  it('API 키 3(사용 중 2·폐기 1)·연계 설정 3(브리지 실행 1)·등록 규칙·메시지 변환 성공·실패', async () => {
    const keys = (await http().get('/api/api-keys').expect(200)).body.items;
    expect(keys.map((k: any) => [k.keyId, k.role, k.state])).toEqual([
      ['AK-0003', 'SYSTEM', 'REVOKED'],
      ['AK-0002', 'AUDITOR', 'ACTIVE'],
      ['AK-0001', 'SYSTEM', 'ACTIVE'],
    ]);
    const links = (await http().get('/api/legacy/links').expect(200)).body.items;
    expect(links.map((l: any) => [l.system, l.bridgeType, l.status, l.lastRun?.status ?? null])).toEqual([
      ['ERP-TMA', 'BATCH', 'ACTIVE', 'SUCCEEDED'],
      ['ERP-HMA', 'FILE', 'INACTIVE', null],
      ['DMS-KR', 'REALTIME', 'ACTIVE', null],
    ]);
    const rules = (await http().get('/api/legacy/mappings').expect(200)).body.items;
    expect(rules.find((r: any) => r.legacyCode === 'OPT-CNAV')).toMatchObject({ source: 'REGISTERED', featureId: 'FEAT-00024' });
    const msgs = (await http().get('/api/legacy-sdv/messages').expect(200)).body.items;
    expect(msgs.map((m: any) => m.status)).toEqual(['FAILED', 'CONVERTED']);
  });

  it('정산 — 두 달 전 실패 뒤 재전송, 직전 달 주기 전송', async () => {
    const t = (await http().get('/api/settlement/transmissions').expect(200)).body.items;
    expect(t.map((x: any) => [x.period, x.status, x.trigger])).toEqual([
      ['2026-10', 'SENT', 'SCHEDULE'],
      ['2026-09', 'SENT', 'MANUAL'],
      ['2026-09', 'FAILED', 'MANUAL'],
    ]);
    expect((await http().get('/api/settlement/usage').expect(200)).body.sent).toMatchObject({ transmissionId: t[0].transmissionId });
  });

  it('다시 부팅해도 한 번만 — meta 표식', async () => {
    get<ExtGatewaySeeder>(ExtGatewaySeeder).onApplicationBootstrap();
    expect((await http().get('/api/api-keys').expect(200)).body.items).toHaveLength(3);
  });
});
