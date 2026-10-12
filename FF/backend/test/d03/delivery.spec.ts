// PoC ④⑤⑥ 배포·차단 전달 — 서명(D06-10) → 보안 배포(D06-08) → 파이프라인(D04-01, IF-05/13) → 차량 런타임(D02-03)
// → 회신 수집(D04-03, IF-06) → P0 aggregate, 긴급 차단(D03-03)·이전 상태 복구(D03-04). 스케줄러는 manual — 회신·기한을 결정적으로 돌린다.
// vECU는 같은 계약의 시험 대역 — 가상검증(D06-03·D06-06) 없이는 FEAT-00022 정책이 GO가 될 수 없다
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', VECU_DIR: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-vecu'), FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-vv-')) });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { Scheduler } from '../../src/kernel/scheduler';
import { VehicleRuntimeService } from '../../src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const OPERATOR = actor('seo.ops', 'OPERATOR');
const SAFETY = actor('park.safety', 'SAFETY_OFFICER');
const SYSTEM = actor('fleet-collector', 'SYSTEM');

/** FEAT-00022 적용 범위(KR/NX4 PE/Premium) 차량 — KMH-NX4-0003은 통신 단절(OFFLINE) */
const SCOPE = ['KMH-NX4-0001', 'KMH-NX4-0002', 'KMH-NX4-0003', 'KMH-NX4-0004', 'ego-01', 'lead-01'];
const OFFLINE = 'KMH-NX4-0003';

describe('배포·차단 전달 (PoC ④⑤⑥)', () => {
  let app: INestApplication;
  let http: () => any;
  let scheduler: Scheduler;
  let runtime: VehicleRuntimeService;
  beforeAll(async () => {
    ({ app, http } = await bootApp());
    app.get(Clock).set('2026-10-12T01:00:00.000Z');
    scheduler = app.get(Scheduler);
    runtime = app.get(VehicleRuntimeService);
  });
  afterAll(async () => {
    await app.close();
    delete process.env.FF_SCHEDULER; // 같은 워커의 다음 시험 파일에 새지 않게
    delete process.env.GLEO_MODE;
    delete process.env.VECU_DIR;
    delete process.env.FF_EVIDENCE_DIR;
  });

  /** 기한까지 시간을 흘린다 — 차량 회신 지연·회신 기한이 같은 시계를 쓴다 */
  const advance = (ms: number) => {
    const clock = app.get(Clock);
    const until = clock.now().getTime() + ms;
    scheduler.flush(ms);
    clock.set(new Date(until));
  };
  const pub = async (id: string) => (await http().get(`/api/publications/${id}`).expect(200)).body;
  const decide = async (vin: string) => (await http().get(`/api/activation/decide?vin=${vin}&flagKey=care_00022_param`).expect(200)).body.result;

  it('서명 키: Ed25519 활성 키 1개, 공개키만 노출', async () => {
    const r = await http().get('/api/pki/keys').expect(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ keyId: 'KEY-0001', alg: 'Ed25519', status: 'ACTIVE' });
    expect(r.body.items[0].publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(r.body)).not.toContain('PRIVATE');
  });

  describe('④ 정책 배포 → 서명 게시본 → OTA → 차량 적용·회신', () => {
    let pid: string;
    let pubId: string;

    it('정책 작성·검증(GO)·승인·서버 배포 → 같은 트랜잭션에서 서명 게시본이 생기고 바로 전개 요청된다', async () => {
      const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: 'care_00022_param', description: '감속 요청 파라미터 r2', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
      pid = c.body.policyId;
      await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid }).expect(201);
      const v = await http().post(`/api/policies/${pid}/validate`).set(AUTHOR).send({}).expect(200);
      expect(v.body.run.reasons).toEqual([]);
      expect(v.body.run.decision).toBe('GO');
      await http().post(`/api/policies/${pid}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
      const d = await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: '배포' }).expect(200);
      pubId = d.body.publicationId;
      expect(pubId).toMatch(/^PUB-\d{5}$/);

      const p = await pub(pubId);
      expect(p.publication).toMatchObject({ kind: 'POLICY', status: 'DISPATCHED', channel: 'OTA', campaignId: expect.stringMatching(/^CMP-\d{5}$/), denominator: 6 });
      expect(p.publication.payload.targets.sort()).toEqual(SCOPE);
      expect(p.publication.payload.desired).toBe(p.publication.payload.policy.contentHash);
      expect(p.verification).toEqual({ valid: true, reason: 'SIGNATURE_VALID' });
      // IF-13 산출물 → IF-05 캠페인, 게시본 ID를 멱등 키로 한 번씩
      expect(p.calls.map((c: any) => c.ifId).sort()).toEqual(['IF-05', 'IF-13']);
    });

    it('연결된 차량 5대는 적용 후 정책 해시를 되읽어 회신, 통신 단절 1대는 무회신 → 기한 후 PARTIAL(5/6)', async () => {
      advance(2_000);
      let p = await pub(pubId);
      expect(p.publication.status).toBe('DISPATCHED'); // 아직 기한 전 — 1대가 남았다
      expect(p.publication.confirmed).toBe(5);
      advance(10_000);
      p = await pub(pubId);
      expect(p.publication.status).toBe('PARTIAL');
      expect(p.publication.nodes.find((n: any) => n.nodeId === OFFLINE)).toMatchObject({ state: 'UNKNOWN', reason: 'NO_REPORT' });
      expect(p.readbacks.every((r: any) => r.observed === p.publication.payload.desired && r.via === 'IF-06')).toBe(true);
    });

    it('차량 측 평가 — 캐시된 서명 정책으로 같은 평가기를 돌리고 서버 판단과 일치(drift 없음)', async () => {
      const r = await http().get('/api/vehicles/ego-01/runtime').expect(200);
      expect(r.body.runtime.bundles.care_00022_param.publicationId).toBe(pubId);
      const e = r.body.evaluations.find((x: any) => x.flagKey === 'care_00022_param');
      expect(e.local.value).toBe(true);
      expect(e.server.value).toBe(true);
      expect(e.drift).toBe(false);
    });

    it('차량은 변조된 게시본과 재전송을 거부한다 (서명·순번)', async () => {
      const original = (await pub(pubId)).publication;
      const tampered = { ...original, payload: { ...original.payload, policy: { ...original.payload.policy, enabled: false } } };
      runtime.receive('KMH-NX4-0001', tampered);
      runtime.receive('KMH-NX4-0002', original);
      const rb = (await http().get(`/api/telemetry/readbacks?publicationId=${pubId}`).expect(200)).body.items;
      expect(rb.at(-2)).toMatchObject({ vin: 'KMH-NX4-0001', observed: 'REJECTED', rejectReason: 'PAYLOAD_TAMPERED' });
      expect(rb.at(-1)).toMatchObject({ vin: 'KMH-NX4-0002', observed: 'REJECTED', rejectReason: 'REPLAY' });
      // 거부된 본문은 적용되지 않는다
      const s = (await http().get('/api/vehicles/KMH-NX4-0001/runtime').expect(200)).body.runtime;
      expect(s.bundles.care_00022_param.policy.enabled).toBe(true);
    });
  });

  describe('위조 사본 — 회신 집계 보호', () => {
    // 회귀: 변조된 사본이 진짜 게시본보다 먼저 도착하면 그 거부 회신이 집계되어 게시본 전체가 DIVERGED로 닫혔다(위조 한 건으로 정상 배포를 실패 처리).
    it('먼저 온 변조 사본의 거부는 보안 신호일 뿐 — 게시본은 닫히지 않고, 뒤에 온 진짜 게시본 적용으로 확인된다', async () => {
      const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Signal', flagKey: 'care_00022_signal', description: '신호 r2', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
      await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: c.body.policyId }).expect(201);
      expect((await http().post(`/api/policies/${c.body.policyId}/validate`).set(AUTHOR).send({}).expect(200)).body.run.decision).toBe('GO');
      await http().post(`/api/policies/${c.body.policyId}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO' }).expect(200);
      const id = (await http().post(`/api/policies/${c.body.policyId}/deploy`).set(RELEASE).send({ reason: '배포' }).expect(200)).body.publicationId;
      const genuine = (await pub(id)).publication;
      runtime.receive('KMH-NX4-0001', { ...genuine, payload: { ...genuine.payload, desired: 'sha256:forged' } });
      let p = await pub(id);
      expect(p.publication.status).toBe('DISPATCHED');
      expect(p.publication.nodes.find((n: any) => n.nodeId === 'KMH-NX4-0001')).toMatchObject({ state: 'UNKNOWN', reason: 'REJECTED:PAYLOAD_TAMPERED' });
      advance(2_000); // 진짜 게시본이 도착·적용
      p = await pub(id);
      expect(p.publication.nodes.find((n: any) => n.nodeId === 'KMH-NX4-0001')).toMatchObject({ state: 'CONFIRMED', reason: 'READBACK_MATCH' });
      advance(10_000);
    });
  });

  describe('⑥ 긴급 차단 → 서버 즉시 Safe Default → 차량 회신 → 해제·복구', () => {
    let killId: string;

    it('영향 범위: FEAT-00145를 막으면 이를 REQUIRES하는 FEAT-00022와 그 배포 flag·차량까지', async () => {
      const f = (await http().get('/api/features?q=FEAT-00145&latestOnly=true').expect(200)).body.items[0];
      const r = await http().get(`/api/kill-requests/preview?featureId=FEAT-00145&featureVersion=${f.version}`).expect(200);
      expect(r.body.featureIds).toEqual(['FEAT-00145', 'FEAT-00022']);
      expect(r.body.flagKeys).toEqual(['care_00022_param', 'care_00022_signal']);
      expect(r.body.vehicles.map((v: any) => v.vin).sort()).toEqual(SCOPE);
    });

    it('권한 없는 역할은 403(DENIED 감사), 확인 입력이 다르면 400(FAILED 감사)', async () => {
      const body = { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], safeMode: 'SAFE_STOP', reason: '오작동 확인', confirm: 'FEAT-00022' };
      await http().post('/api/kill-requests').set(AUTHOR).send(body).expect(403);
      await http().post('/api/kill-requests').set(OPERATOR).send({ ...body, confirm: 'FEAT-0002' }).expect(400);
      const a = (await http().get('/api/audit?target=FEAT-00022&result=FAILED').expect(200)).body.items;
      expect(a[0]).toMatchObject({ action: 'KILL_ISSUE', result: 'FAILED' });
    });

    it('차단 발령 즉시 서버 판단이 Safe Default(KILL_SWITCH) — 범위 밖 차량은 그대로', async () => {
      expect((await decide('ego-01')).value).toBe(true);
      const r = await http().post('/api/kill-requests').set(OPERATOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01', 'lead-01'], safeMode: 'SAFE_STOP', reason: '전방 거리 오추정', confirm: 'FEAT-00022' }).expect(201);
      killId = r.body.killId;
      expect(r.body).toMatchObject({ killId: 'KILL-00001', status: 'ACTIVE', featureIds: ['FEAT-00022'], vins: ['ego-01', 'lead-01'] });
      expect(await decide('ego-01')).toMatchObject({ value: false, decision: 'SAFE_DEFAULT', reason: 'KILL_SWITCH' });
      expect((await decide('KMH-NX4-0001')).value).toBe(true);
      // 같은 Feature 중복 차단 금지
      await http().post('/api/kill-requests').set(SAFETY).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', safeMode: 'SAFE_DEFAULT', reason: '중복', confirm: 'FEAT-00022' }).expect(409);
    });

    it('긴급 채널로 서명 전달 → 대상 2대 모두 SAFE_STOP 회신 → CONFIRMED, 차량 측 평가도 KILL_SWITCH', async () => {
      let k = (await http().get(`/api/kill-requests/${killId}`).expect(200)).body;
      expect(k.delivery).toMatchObject({ status: 'DISPATCHED', confirmed: 0, denominator: 2 });
      advance(1_000);
      k = (await http().get(`/api/kill-requests/${killId}`).expect(200)).body;
      expect(k.delivery).toMatchObject({ status: 'CONFIRMED', confirmed: 2, denominator: 2 });
      const v = (await http().get('/api/vehicles/ego-01/runtime').expect(200)).body;
      expect(v.runtime.featureState['FEAT-00022']).toBe('SAFE_STOP');
      expect(v.evaluations.find((x: any) => x.flagKey === 'care_00022_param').local.reason).toBe('KILL_SWITCH');
      const p = await pub(k.publicationId);
      expect(p.publication).toMatchObject({ kind: 'KILL', channel: 'EMERGENCY' });
    });

    it('해제 → 서버 판단 즉시 복구, 복구 게시본 회신 ACTIVE → CONFIRMED. 두 번 해제는 422', async () => {
      const r = await http().post(`/api/kill-requests/${killId}/release`).set(SAFETY).send({ reason: '원인 수정 확인' }).expect(200);
      expect(r.body).toMatchObject({ status: 'RELEASED', releasedBy: 'park.safety' });
      expect((await decide('ego-01')).value).toBe(true);
      advance(1_000);
      const k = (await http().get(`/api/kill-requests/${killId}`).expect(200)).body;
      expect(k.restore).toMatchObject({ status: 'CONFIRMED', confirmed: 2 });
      expect((await http().get('/api/vehicles/ego-01/runtime').expect(200)).body.runtime.featureState['FEAT-00022']).toBe('ACTIVE');
      await http().post(`/api/kill-requests/${killId}/release`).set(SAFETY).send({ reason: '다시' }).expect(422);
    });

    it('복구 후 예전 차단 명령이 다시 와도 차량은 거부한다 (같은 Feature 순번 공간)', async () => {
      const k = (await http().get(`/api/kill-requests/${killId}`).expect(200)).body;
      runtime.receive('ego-01', (await pub(k.publicationId)).publication);
      const s = (await http().get('/api/vehicles/ego-01/runtime').expect(200)).body.runtime;
      expect(s.featureState['FEAT-00022']).toBe('ACTIVE');
      expect(s.log.at(-1)).toMatchObject({ result: 'REJECTED', detail: 'REPLAY' });
    });

    it('범위 전체 차단은 통신 단절 차량 때문에 기한 후 PARTIAL — 회신 못 한 차량이 그대로 보인다', async () => {
      const r = await http().post('/api/kill-requests').set(OPERATOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', safeMode: 'SAFE_DEFAULT', reason: '전체 차단 시험', confirm: 'FEAT-00022' }).expect(201);
      advance(10_000);
      const k = (await http().get(`/api/kill-requests/${r.body.killId}`).expect(200)).body;
      expect(k.delivery).toMatchObject({ status: 'PARTIAL', confirmed: 5, denominator: 6 });
      expect(k.delivery.nodes.find((n: any) => n.nodeId === OFFLINE).reason).toBe('NO_REPORT');
      await http().post(`/api/kill-requests/${r.body.killId}/release`).set(OPERATOR).send({ reason: '시험 종료' }).expect(200);
      advance(10_000);
    });
  });

  describe('IF-06 수집 입구 · 키 교체', () => {
    it('외부 회신은 시스템 계정만, 대상 밖 차량은 400', async () => {
      const p = (await http().get('/api/publications?kind=POLICY').expect(200)).body.items[0];
      const body = { vin: 'HMA-NX4-0001', publicationId: p.publicationId, metricType: 'READBACK', policyHash: p.signature.payloadHash, featureVersion: '1.0.0', bootId: 'x', sequence: p.payload.sequence, observed: 'x' };
      await http().post('/api/telemetry/readback').set(OPERATOR).send(body).expect(403);
      await http().post('/api/telemetry/readback').set(SYSTEM).send(body).expect(400);
    });

    it('키 교체는 안전 담당만 — 새 키로 서명하고, 이전 키로 서명한 게시본은 계속 검증된다', async () => {
      const before = (await http().get('/api/publications').expect(200)).body.items.at(-1);
      await http().post('/api/pki/rotate').set(OPERATOR).send({ reason: '정기 교체' }).expect(403);
      const r = await http().post('/api/pki/rotate').set(SAFETY).send({ reason: '정기 교체' }).expect(201);
      expect(r.body).toMatchObject({ keyId: 'KEY-0002', status: 'ACTIVE' });
      const keys = (await http().get('/api/pki/keys').expect(200)).body.items;
      expect(keys.map((k: any) => [k.keyId, k.status])).toEqual([['KEY-0001', 'RETIRED'], ['KEY-0002', 'ACTIVE']]);
      expect((await pub(before.publicationId)).verification.valid).toBe(true);
      const k = await http().post('/api/kill-requests').set(OPERATOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], safeMode: 'SAFE_DEFAULT', reason: '새 키 확인', confirm: 'FEAT-00022' }).expect(201);
      expect((await pub(k.body.publicationId)).publication.signature.keyId).toBe('KEY-0002');
    });
  });
});

describe('부팅 동기화', () => {
  it('시드로 배포(DEPLOYED)된 정책은 부팅 때 서명 게시본으로 차량에 전달된다 — 서버와 차량이 같은 정책을 본다', async () => {
    Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
    const { app, http } = await bootApp();
    try {
      const pubs = (await http().get('/api/publications?kind=POLICY').expect(200)).body.items;
      expect(pubs.map((p: any) => [p.payload.flagKey, p.createdBy]).sort()).toEqual([['care_00022_param', 'system'], ['care_00022_signal', 'system']]);
      app.get(Scheduler).flush();
      const v = (await http().get('/api/vehicles/ego-01/runtime').expect(200)).body;
      expect(Object.keys(v.runtime.bundles).sort()).toEqual(['care_00022_param', 'care_00022_signal']);
      expect(v.evaluations.every((e: any) => !e.drift)).toBe(true);
    } finally {
      await app.close();
      delete process.env.FF_SCHEDULER;
      delete process.env.GLEO_MODE;
    }
  });
});
