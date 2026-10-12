// IF-04 Policy Tool (Unleash OSS) 연계 — 모의 Unleash(같은 Admin API 경로·응답 모양)로 동기화·대조·drift를 끝까지,
// live 모드는 연결 실패·허용 목록 거부를, 실제 Unleash(127.0.0.1:4242)가 떠 있으면 실연동까지 확인한다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockUnleash, UnleashGateway, allowed } from '../../src/adapters/unleash/unleash.client';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const OPERATOR = actor('seo.ops', 'OPERATOR');
const POL = 'POL-00002'; // 시드 배포 정책 care_00022_param

describe('Unleash 연계 (IF-04) — 모의', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    Object.assign(process.env, { UNLEASH_MODE: 'mock', GLEO_MODE: 'internal' });
    ({ app, http } = await bootApp());
    app.get(Clock).set('2026-10-12T01:00:00.000Z');
  });
  afterAll(async () => {
    await app.close();
    delete process.env.UNLEASH_MODE;
    delete process.env.GLEO_MODE;
  });

  it('계획: 배포 정책 → flexibleRollout 100% + 적용 범위·권한 제약, flag 없는 REQUIRES는 참고, 서버엔 아직 없음', async () => {
    expect((await http().get('/api/unleash/status').expect(200)).body).toMatchObject({ mode: 'mock', state: 'OK' });
    const v = (await http().get(`/api/policies/${POL}/unleash`).expect(200)).body;
    expect(v.plan).toMatchObject({ flagName: 'care_00022_param', ready: true, enabled: true, dependencies: [] });
    expect(v.plan.notes[0]).toMatch(/REQUIRES FEAT-00145/);
    expect(v.drift).toEqual(['Unleash에 flag가 없습니다']);
  });

  it('동기화는 출시 담당·운영자만 — 생성 → 태그 → 전략 → 환경 on, 이후 drift 없음', async () => {
    await http().post(`/api/policies/${POL}/unleash/sync`).set(AUTHOR).send({}).expect(403);
    const r = (await http().post(`/api/policies/${POL}/unleash/sync`).set(RELEASE).send({}).expect(200)).body;
    expect(r.outcome).toBe('SYNCED');
    expect(r.steps[0]).toMatchObject({ name: 'ensureFlag', state: 'OK', detail: 'CREATED' });
    expect(r.steps.map((s: any) => s.name)).toEqual(expect.arrayContaining(['tagTypes', 'tag fp-policy=POL-00002@r1', 'attach fp-digest', 'strategy POST', 'environment on']));
    expect((await http().get(`/api/policies/${POL}/unleash`).expect(200)).body.drift).toEqual([]);
  });

  it('다시 동기화하면 같은 결과(upsert) — flag 재사용, 전략은 하나 대 하나 갱신', async () => {
    const r = (await http().post(`/api/policies/${POL}/unleash/sync`).set(OPERATOR).send({}).expect(200)).body;
    expect(r.outcome).toBe('SYNCED');
    expect(r.steps[0].detail).toBe('REUSED');
    expect(r.steps.find((s: any) => s.name === 'strategy PUT')).toMatchObject({ state: 'OK', detail: 'UPDATED' });
    expect((app.get(UnleashGateway).client as MockUnleash).features.get('care_00022_param')!.strategies.development).toHaveLength(1);
    const calls = (await http().get('/api/integrations/calls?ifId=IF-04').expect(200)).body.items;
    expect(calls).toHaveLength(2);
    expect(calls[0].response.outcome).toBe('SYNCED');
  });

  it('차량별 대조: 믿을 수 있는 문맥의 차량은 모두 일치, STALE·UNTRUSTED는 비교 제외(플랫폼은 HOLD)', async () => {
    const e = (await http().get(`/api/policies/${POL}/unleash/evaluation`).expect(200)).body;
    expect(e.summary).toMatchObject({ vehicles: 12, mismatch: 0, error: 0, noContext: 2 });
    expect(e.rows.find((r: any) => r.vin === 'ego-01')).toMatchObject({ unleash: true, platform: true, verdict: 'AGREE' });
    expect(e.rows.find((r: any) => r.vin === 'KMH-NX4-0002')).toMatchObject({ unleash: false, platform: false, verdict: 'AGREE' }); // 권한 없음
    expect(e.rows.find((r: any) => r.vin === 'KMH-NX4-0003')).toMatchObject({ verdict: 'NO_CONTEXT' });
  });

  it('긴급 차단은 FP에만 — 차단 중인 차량은 불일치로 드러나고 이유가 붙는다', async () => {
    const k = await http().post('/api/kill-requests').set(OPERATOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], safeMode: 'SAFE_DEFAULT', reason: '대조 시험', confirm: 'FEAT-00022' }).expect(201);
    const e = (await http().get(`/api/policies/${POL}/unleash/evaluation`).expect(200)).body;
    expect(e.rows.find((r: any) => r.vin === 'ego-01')).toMatchObject({ unleash: true, platform: false, verdict: 'MISMATCH', why: expect.stringMatching(/긴급 차단은 FP에서만/) });
    await http().post(`/api/kill-requests/${k.body.killId}/release`).set(OPERATOR).send({ reason: '시험 종료' }).expect(200);
  });

  it('Unleash에서 직접 바꾼 흔적(drift)을 찾는다 — FP가 원천', async () => {
    (app.get(UnleashGateway).client as MockUnleash).tamper('care_00022_param', (f) => {
      f.strategies.development[0].parameters.rollout = '50';
      f.enabled.development = false;
    });
    const d = (await http().get(`/api/policies/${POL}/unleash`).expect(200)).body.drift;
    expect(d).toEqual(expect.arrayContaining([expect.stringMatching(/전략·제약이 다릅니다/), expect.stringMatching(/활성 상태가 다릅니다/)]));
    await http().post(`/api/policies/${POL}/unleash/sync`).set(RELEASE).send({}).expect(200);
    expect((await http().get(`/api/policies/${POL}/unleash`).expect(200)).body.drift).toEqual([]);
  });

  it('배포 전 정책은 BLOCKED — 서버를 건드리지 않고 FAILED 감사', async () => {
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Signal', flagKey: 'care_00022_draft', description: '초안', safeDefault: false }).expect(201);
    const r = (await http().post(`/api/policies/${c.body.policyId}/unleash/sync`).set(RELEASE).send({}).expect(200)).body;
    expect(r.outcome).toBe('BLOCKED');
    expect(r.steps).toEqual([]);
    expect((app.get(UnleashGateway).client as MockUnleash).features.has('care_00022_draft')).toBe(false);
    const a = (await http().get(`/api/audit?target=${c.body.policyId}&result=FAILED`).expect(200)).body.items;
    expect(a[0]).toMatchObject({ action: 'UNLEASH_SYNC' });
  });
});

describe('Unleash 연계 — live 모드 안전장치', () => {
  it('Admin API 허용 목록 밖 경로는 부르지 않는다', () => {
    expect(allowed('projects/default/features/care_00022_param/environments/development/on')).toBe(true);
    expect(allowed('playground/advanced')).toBe(true);
    expect(allowed('user-admin')).toBe(false);
    expect(allowed('projects/default/features/x/../../../admin')).toBe(false);
  });

  it('연결이 안 되면 상태 FAILED, 동기화는 첫 단계에서 FAILED로 멈춘다', async () => {
    Object.assign(process.env, { UNLEASH_MODE: 'live', UNLEASH_URL: 'http://127.0.0.1:9', GLEO_MODE: 'internal' });
    const { app, http } = await bootApp();
    try {
      expect((await http().get('/api/unleash/status').expect(200)).body).toMatchObject({ mode: 'live', state: 'FAILED' });
      const r = (await http().post(`/api/policies/${POL}/unleash/sync`).set(RELEASE).send({}).expect(200)).body;
      expect(r.outcome).toBe('FAILED');
      expect(r.steps.at(-1).why).toMatch(/Unleash 연결 실패/);
    } finally {
      await app.close();
      delete process.env.UNLEASH_MODE;
      delete process.env.UNLEASH_URL;
      delete process.env.GLEO_MODE;
    }
  });
});

// 실연동은 명시적으로 켠다: npm run unleash:up 후 UNLEASH_LIVE=1 UNLEASH_ADMIN_TOKEN=<관리 토큰> (UNLEASH_LIVE_URL 기본 4242)
const LIVE = process.env.UNLEASH_LIVE_URL ?? 'http://127.0.0.1:4242';
describe.runIf(process.env.UNLEASH_LIVE === '1' && !!process.env.UNLEASH_ADMIN_TOKEN)('Unleash 실연동 (도커 unleashorg/unleash-server:8.2.0)', () => {
  it('배포 정책을 실제 Unleash에 동기화하고 차량별 판단이 일치한다', async () => {
    Object.assign(process.env, { UNLEASH_MODE: 'live', UNLEASH_URL: LIVE, GLEO_MODE: 'internal' });
    const { app, http } = await bootApp();
    try {
      const r = (await http().post(`/api/policies/${POL}/unleash/sync`).set(RELEASE).send({}).expect(200)).body;
      expect(r.outcome, JSON.stringify(r.steps.at(-1))).toBe('SYNCED');
      expect((await http().get(`/api/policies/${POL}/unleash`).expect(200)).body.drift).toEqual([]);
      expect((await http().get(`/api/policies/${POL}/unleash/evaluation`).expect(200)).body.summary.mismatch).toBe(0);
    } finally {
      await app.close();
      delete process.env.UNLEASH_MODE;
      delete process.env.UNLEASH_URL;
      delete process.env.GLEO_MODE;
    }
  }, 60_000);
});
