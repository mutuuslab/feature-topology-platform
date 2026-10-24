// 모의 연계 표시 근거 — GET /api/system/connections, 운영 모드에서 모의 과금은 결제를 만들지 않는다.
// readiness: RD-UX-04
import { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BillingService } from '../../src/domains/d05-ext/billing/billing.controller';
import { KernelController } from '../../src/kernel/kernel.controller';
import { actor, bootApp } from '../helpers';

const OPERATOR = actor('seo.ops', 'OPERATOR');

describe('외부 연결 상태 (RD-UX-04)', () => {
  let app: INestApplication;
  let http: () => any;
  let get: <T>(t: any) => T;
  beforeAll(async () => ({ app, http, get } = await bootApp({ at: '2026-10-12T01:00:00.000Z' })));
  afterAll(() => app.close());
  afterEach(() => {
    delete process.env.FF_ENV;
    delete process.env.FF_CONN_MAIL;
    delete process.env.IF_MODE_05;
  });

  it('데모 설치 — 메일·과금·OTA는 모의, Data Lake는 연결 없음', async () => {
    const r = await http().get('/api/system/connections').expect(200);
    expect(r.body.mode).toBe('demo');
    expect(Object.fromEntries(r.body.items.map((i: any) => [i.key, i.mode]))).toEqual({ mail: 'mock', billing: 'mock', ota: 'mock', datalake: 'off' });
    expect(r.body.items.every((i: any) => i.liveAdapter === false)).toBe(true);
  });

  it('설정을 따른다 — 실제 어댑터가 없으면 live로 바꿔도 모의, IF_MODE_05=off면 OTA 꺼짐', async () => {
    process.env.FF_CONN_MAIL = 'live';
    process.env.IF_MODE_05 = 'off';
    const r = await http().get('/api/system/connections').expect(200);
    const by = Object.fromEntries(r.body.items.map((i: any) => [i.key, i.mode]));
    expect(by.mail).toBe('mock');
    expect(by.ota).toBe('off');
  });

  it('운영 모드 — 화면이 연결 안 됨으로 보이도록 mode=production, 모의 과금 결제는 거부(결과를 실제처럼 남기지 않는다)', async () => {
    await http().get('/api/trials?source=DEMO&catalogId=CAT-00019').expect(200);
    await http().post('/api/trials/ENT-00003/accept').set(OPERATOR).send({}).expect(200);
    // 운영 모드는 SSO 신원이 있어야 HTTP에 닿으므로(익명 401) 서비스·컨트롤러를 직접 부른다
    process.env.FF_ENV = 'production';
    expect(get<KernelController>(KernelController).connections().mode).toBe('production');
    let err: any = null;
    try {
      get<BillingService>(BillingService).purchase({ id: 'seo.ops', role: 'OPERATOR', correlationId: 'c-1' } as never, 'ENT-00003', '구독');
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: 'GUARD_FAILED', details: { connection: 'billing', mode: 'mock' } });
    expect(err.status).toBe(422);
    delete process.env.FF_ENV;
    // 데모 설치에서는 같은 요청이 모의 결제로 처리된다
    await http().post('/api/trials/ENT-00003/purchase').set(OPERATOR).send({ plan: '구독' }).expect(200);
  });
});
