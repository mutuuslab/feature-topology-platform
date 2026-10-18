// 기능명세서 결함 기록 — harness/requirements/review.json의 defects와 짝을 이룬다(tools/requirements.ts가 맞춰 본다).
// it.fails: 결함이 그대로면 통과한다. 고치면 이 시험이 실패한다 → it(으로 바꾸고, review.json 결함 목록에서 빼고, 판정을 갱신한다.
// 시험마다 앱을 새로 띄운다 — 한 결함의 재현 단계(Feature 사용 중단 등)가 다른 결함 기록에 새지 않게.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', CARLA_RUNNER: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-req-')) });
import { afterAll, describe, expect, it } from 'vitest';
import { EntitlementSchema } from '@ff/contracts';
import { DB, type Db } from '../../src/kernel/db';
import { Scheduler } from '../../src/kernel/scheduler';
import { VehicleRuntimeService } from '../../src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const PRODUCT = actor('park.product', 'PRODUCT_AUTHOR');
const AT = '2026-10-12T01:00:00.000Z';

/** 시드 배포 정책이 차량에 전달된 상태(부팅 동기화)로 띄운다 */
async function boot() {
  const b = await bootApp({ at: AT });
  b.app.get(Scheduler).flush();
  return b;
}

describe('기능명세서 결함 기록 — 차량 런타임·정책 배포', () => {
  afterAll(() => {
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'CARLA_RUNNER', 'FF_EVIDENCE_DIR']) delete process.env[k];
  });

  it.fails('FR-RTE-005-001 차량 측 평가도 지원 조건을 본다 — SW 미달 차량(KMH-NX4-0002)에 구독이 생겨도 서버·차량 모두 OFF(어긋남 없음)', async () => {
    const { app, http } = await boot();
    try {
      // 체험 제안은 이제 SW 미달 차량을 거른다(skipped) — 구독은 판정 이전부터 있던 것(외부 결제·SW 다운그레이드 전 구독)으로 넣는다
      const offer = (await http().post('/api/trials/offers').set(PRODUCT).send({ catalogId: 'CAT-00019', vins: ['KMH-NX4-0002'] }).expect(201)).body;
      expect(offer.skipped).toEqual([expect.objectContaining({ vin: 'KMH-NX4-0002' })]);
      const grant = { grantId: 'ENT-90001', vin: 'KMH-NX4-0002', catalogId: 'CAT-00019', kind: '구독', validFrom: '2026-01-01', validTo: '2027-12-31', status: 'ACTIVE', source: 'DEMO' };
      app.get<Db>(DB).run('INSERT INTO entitlement (grant_id, vin, catalog_id, status, source, doc) VALUES (?, ?, ?, ?, ?, ?)', grant.grantId, grant.vin, grant.catalogId, grant.status, grant.source, JSON.stringify(EntitlementSchema.parse(grant)));
      const v = (await http().get('/api/vehicles/KMH-NX4-0002/runtime').expect(200)).body;
      const e = v.evaluations.find((x: any) => x.flagKey === 'care_00022_param');
      expect(e.server).toMatchObject({ value: false, reason: 'NOT_SUPPORTED' }); // 서버 판단은 이미 맞다(활성화 전 지원 조건)
      expect(e.local).toMatchObject({ value: false, reason: 'NOT_SUPPORTED' });
      expect(e.drift).toBe(false);
    } finally {
      await app.close();
    }
  });

  it.fails('FR-RTE-001-004 차량은 자기 VIN이 대상에 없는 정책 게시본을 거부하고 기록한다', async () => {
    const { app, http } = await boot();
    try {
      const pubs = (await http().get('/api/publications?kind=POLICY').expect(200)).body.items;
      const p = pubs.find((x: any) => x.payload.flagKey === 'care_00022_param');
      const outsider = 'HMA-NX4-0001';
      expect(p.payload.targets).not.toContain(outsider);
      const { publication } = (await http().get(`/api/publications/${p.publicationId}`).expect(200)).body;
      // 지금은 차량이 적용·저장한 뒤 회신하고, 플랫폼 수집기(D04-03)가 대상 밖 회신을 거부하며 예외를 낸다.
      // 그 거부는 플랫폼 쪽 방어이고, 요구는 차량이 먼저 거르는 것이다 — 예외는 넘기고 차량 상태를 본다
      try {
        app.get(VehicleRuntimeService).receive(outsider, publication);
      } catch {
        /* 대상 밖 회신 거부 */
      }
      const s = (await http().get(`/api/vehicles/${outsider}/runtime`).expect(200)).body.runtime;
      expect(s.bundles.care_00022_param).toBeUndefined();
      expect(s.log.at(-1)).toMatchObject({ publicationId: p.publicationId, result: 'REJECTED' });
    } finally {
      await app.close();
    }
  });

  it.fails('FR-REG-002-019 사용 중단(DEPRECATED)된 Feature의 정책은 승인돼 있어도 배포되지 않는다', async () => {
    const { app, http } = await boot();
    try {
      const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '감속 요청 파라미터 r2', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
      const pid = c.body.policyId;
      await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid }).expect(201);
      expect((await http().post(`/api/policies/${pid}/validate`).set(AUTHOR).send({}).expect(200)).body.run.decision).toBe('GO');
      await http().post(`/api/policies/${pid}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
      await http().post('/api/features/FEAT-00022/versions/1.0.0/transitions').set(RELEASE).send({ to: 'DEPRECATED', reason: '1.1.0으로 대체' }).expect(200);
      // 요구 단언 — supertest .expect(422)가 아니라 expect로 둔다(결함 기록 점검이 단언 실패와 재현 실패를 구별한다)
      expect((await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: '배포' })).status).toBe(422);
    } finally {
      await app.close();
    }
  });
});
