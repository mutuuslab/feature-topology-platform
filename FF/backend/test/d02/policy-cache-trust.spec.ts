// P9 — 서명 근거·유효기간·구형 캐시·전체 누락의 실제 차량 조회 경로 회귀.
// 저장 손상은 fixture 안에서만 주입한다. 이는 외부 사용자의 DB 쓰기 권한을 입증하는 시험이 아니다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', CARLA_RUNNER: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-cache-trust-')) });
import type { INestApplication } from '@nestjs/common';
import { PUBLICATION_KEY_PURPOSE, type Publication } from '@ff/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VehicleRuntimeService } from '../../src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { PkiService } from '../../src/domains/d06-qsec/pki-kms/pki.service';
import { RuntimeRepo, type VehicleRuntimeState } from '../../src/domains/d06-qsec/secure-deploy/publication.repo';
import { Clock } from '../../src/kernel/clock';
import { Scheduler } from '../../src/kernel/scheduler';
import { actor, bootApp } from '../helpers';

const VIN = 'ego-01';
const FLAG = 'care_00022_param';
const FEATURE = 'FEAT-00022';
const DAY = 86_400_000;
const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');

describe('차량 캐시 신뢰 경계 — 서명 payload가 유효기간의 정본', () => {
  let app: INestApplication;
  let http: () => any;
  let runtime: VehicleRuntimeService;
  let first: Publication;
  let baseline: VehicleRuntimeState;
  let start: string;
  const repo = () => app.get(RuntimeRepo);
  const view = async () => (await http().get(`/api/vehicles/${VIN}/runtime`).expect(200)).body;
  const cacheOf = (v: any) => v.cache.find((c: any) => c.flagKey === FLAG);
  const edit = (change: (s: VehicleRuntimeState) => void) => { const s = repo().get(VIN); change(s); repo().save(s); };
  const next = (patch: Partial<Publication['payload']> = {}): Publication => {
    const payload = { ...first.payload, sequence: first.payload.sequence + 1, ...patch };
    return { ...first, payload, signature: app.get(PkiService).sign(payload, PUBLICATION_KEY_PURPOSE.POLICY) };
  };

  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
    runtime = app.get(VehicleRuntimeService);
    const created = await http().post('/api/policies').set(AUTHOR).send({ featureId: FEATURE, featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: FLAG, description: '캐시 신뢰 회귀', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    const pid = created.body.policyId;
    await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: pid }).expect(201);
    await http().post(`/api/policies/${pid}/validate`).set(AUTHOR).send({}).expect(200);
    await http().post(`/api/policies/${pid}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
    const id = (await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: '서명 캐시 배포' }).expect(200)).body.publicationId;
    const clock = app.get(Clock);
    const now = clock.now().getTime() + 3000;
    app.get(Scheduler).flush(3000);
    clock.set(new Date(now));
    start = clock.iso();
    first = (await http().get(`/api/publications/${id}`).expect(200)).body.publication;
    baseline = repo().get(VIN);
    baseline.bundles = { [FLAG]: baseline.bundles[FLAG] };
    baseline.featureState[FEATURE] = 'ACTIVE';
    expect(baseline.bundles[FLAG]).toBeTruthy();
  });
  beforeEach(() => { app.get(Clock).set(start); repo().save(structuredClone(baseline)); });
  afterAll(async () => {
    await app?.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'CARLA_RUNNER', 'FF_EVIDENCE_DIR']) delete process.env[k];
  });

  for (const missing of ['both', 'payload', 'signature'] as const) it(`구형 캐시 ${missing} 누락은 보존하되 재취득 전 평가 근거로 쓰지 않는다`, async () => {
    edit(s => {
      if (missing !== 'signature') delete s.bundles[FLAG].payload;
      if (missing !== 'payload') delete s.bundles[FLAG].signature;
      s.bundles[FLAG].previous = null;
    });
    const stored = structuredClone(repo().get(VIN).bundles[FLAG]);
    const v = await view();
    console.info('P9_LEGACY', JSON.stringify({ missing, cache: cacheOf(v) }));
    expect(cacheOf(v)).toMatchObject({ status: 'UNVERIFIED', use: 'SAFE_DEFAULT', delegation: 'CACHE_REACQUIRE_REQUIRED' });
    expect(v.evaluations.find((e: any) => e.flagKey === FLAG).local.decision).toBe('SAFE_DEFAULT');
    expect(v.runtime.bundles[FLAG]).toEqual(stored);
    expect(v.runtime.featureState[FEATURE]).toBe('ACTIVE');
  });

  for (const wrapper of ['future', 'NaN', 'null', 'missing'] as const) it(`wrapper.validUntil ${wrapper} 값이 서명된 만료를 연장하지 못한다`, async () => {
    const until = Date.parse(first.payload.validUntil!);
    app.get(Clock).set(new Date(until + 1));
    edit(s => {
      if (wrapper === 'missing') delete s.bundles[FLAG].validUntil;
      else s.bundles[FLAG].validUntil = wrapper === 'future' ? new Date(until + DAY).toISOString() : wrapper === 'NaN' ? 'not-a-date' : null;
    });
    const v = await view();
    console.info('P9_WRAPPER_TTL', JSON.stringify({ wrapper, cache: cacheOf(v) }));
    expect(cacheOf(v)).toMatchObject({ status: 'EXPIRED', use: 'SAFE_DEFAULT', delegation: 'CACHE_EXPIRED', validUntil: first.payload.validUntil });
    expect(v.runtime.featureState[FEATURE]).toBe('ACTIVE');
  });

  it('바깥 기한을 과거로 바꿔도 아직 유효한 서명 payload를 만료시키지 않는다', async () => {
    edit(s => { s.bundles[FLAG].validUntil = '2000-01-01T00:00:00.000Z'; });
    expect(cacheOf(await view())).toMatchObject({ status: 'VALID', use: 'CURRENT', validUntil: first.payload.validUntil });
  });

  for (const validUntil of [undefined, 'not-a-date']) it(`서명한 POLICY라도 기한 ${String(validUntil)} 수신을 거부하고 순번을 소비하지 않는다`, async () => {
    const pub = next({ validUntil });
    runtime.receive(VIN, pub);
    const received = repo().get(VIN).log.at(-1);
    const v = await view();
    console.info('P9_RECEIVE_TTL', JSON.stringify({ validUntil: validUntil ?? null, received, highest: v.runtime.highest[`flag:${FLAG}`] }));
    expect(received).toMatchObject({ result: 'REJECTED', detail: 'MALFORMED' });
    expect(v.runtime.highest[`flag:${FLAG}`]).toBe(first.payload.sequence);
    expect(cacheOf(v)).toMatchObject({ status: 'VALID', use: 'CURRENT', sequence: first.payload.sequence });
  });

  it('손상된 현재 캐시는 직전의 서명된 정상 캐시로 대체한다', async () => {
    runtime.receive(VIN, next());
    edit(s => { s.bundles[FLAG].payload!.policy!.enabled = false; });
    const v = await view();
    expect(cacheOf(v)).toMatchObject({ status: 'INTEGRITY_MISMATCH', previous: 'VALID', use: 'PREVIOUS' });
    expect(v.evaluations.find((e: any) => e.flagKey === FLAG)).toMatchObject({ local: { value: true }, cache: { use: 'PREVIOUS', sequence: first.payload.sequence } });
    expect(v.runtime.featureState[FEATURE]).toBe('ACTIVE');
  });

  it('미검증 현재 캐시 대신 서명된 정상 직전 캐시는 쓸 수 있다', async () => {
    runtime.receive(VIN, next());
    edit(s => { delete s.bundles[FLAG].signature; });
    expect(cacheOf(await view())).toMatchObject({ status: 'UNVERIFIED', previous: 'VALID', use: 'PREVIOUS', excluded: 'CACHE_REACQUIRE_REQUIRED' });
  });

  it('저장된 서명 payload도 유효 기간이 없으면 재취득이 필요하다', async () => {
    edit(s => {
      delete s.bundles[FLAG].payload!.validUntil;
      s.bundles[FLAG].signature = app.get(PkiService).sign(s.bundles[FLAG].payload!, PUBLICATION_KEY_PURPOSE.POLICY);
      s.bundles[FLAG].previous = null;
    });
    expect(cacheOf(await view())).toMatchObject({ status: 'UNVERIFIED', use: 'SAFE_DEFAULT', delegation: 'CACHE_REACQUIRE_REQUIRED' });
  });

  it('정책과 다른 용도의 키는 거부하고 정상 직전 캐시를 쓴다', async () => {
    edit(s => { s.bundles[FLAG].signature = app.get(PkiService).sign(s.bundles[FLAG].payload!, PUBLICATION_KEY_PURPOSE.KILL); });
    expect(cacheOf(await view())).toMatchObject({ status: 'SIGNATURE_INVALID', previous: 'VALID', use: 'PREVIOUS' });
  });

  it('손상된 서명 필드도 조회 오류 없이 제외하고 직전 정상 캐시를 쓴다', async () => {
    edit(s => { (s.bundles[FLAG].signature as any).signature = null; });
    const v = await view();
    expect(cacheOf(v)).toMatchObject({ status: 'SIGNATURE_INVALID', previous: 'VALID', use: 'PREVIOUS' });
    expect(v.runtime.featureState[FEATURE]).toBe('ACTIVE');
  });

  it('신뢰 키 만료는 정상 서명을 무효로 하고 현재 Active 상태는 임의 종료하지 않는다', async () => {
    const key = app.get(PkiService).keys().find(k => k.keyId === first.signature.keyId)!;
    app.get(Clock).set(new Date(Date.parse(key.notAfter) + 1));
    const v = await view();
    expect(cacheOf(v)).toMatchObject({ status: 'SIGNATURE_INVALID', use: 'SAFE_DEFAULT' });
    expect(v.runtime.featureState[FEATURE]).toBe('ACTIVE');
  });

  it('미검증 직전 캐시는 손상된 현재 캐시를 대신할 수 없다', async () => {
    runtime.receive(VIN, next());
    edit(s => {
      s.bundles[FLAG].payload!.policy!.enabled = false;
      delete s.bundles[FLAG].previous!.payload;
      delete s.bundles[FLAG].previous!.signature;
    });
    const v = await view();
    expect(cacheOf(v)).toMatchObject({ status: 'INTEGRITY_MISMATCH', previous: 'UNVERIFIED', use: 'SAFE_DEFAULT' });
    expect(v.runtime.featureState[FEATURE]).toBe('ACTIVE');
  });

  it('전체 캐시가 없어도 대상 정책의 CACHE_MISSING 위임을 기록하고 수신 평가로 꾸미지 않는다', async () => {
    edit(s => { s.bundles = {}; });
    const v = await view();
    console.info('P9_MISSING', JSON.stringify({ cache: v.cache, last: v.runtime.log.at(-1) }));
    expect(cacheOf(v)).toMatchObject({ status: null, use: 'SAFE_DEFAULT', delegation: 'CACHE_MISSING' });
    expect(v.runtime.log.findLast((l: any) => l.flagKey === FLAG)).toMatchObject({ result: 'SAFE_DEFAULT', detail: 'CACHE_MISSING', featureId: FEATURE });
    expect(v.evaluations.some((e: any) => e.flagKey === FLAG)).toBe(false);
    expect(v.runtime.featureState[FEATURE]).toBe('ACTIVE');
    const repeated = await view();
    expect(repeated.runtime.log.length).toBe(v.runtime.log.length);
  });

  it('캐시 전체 누락은 기존 게시 키가 만료돼도 누락 진단에서 사라지지 않는다', async () => {
    const key = app.get(PkiService).keys().find(k => k.keyId === first.signature.keyId)!;
    app.get(Clock).set(new Date(Date.parse(key.notAfter) + 1));
    edit(s => { s.bundles = {}; });
    expect(cacheOf(await view())).toMatchObject({ status: null, use: 'SAFE_DEFAULT', delegation: 'CACHE_MISSING' });
  });

  it('정상 수신·재전송 거부와 RETIRED 구키 서명 검증을 보존한다', async () => {
    app.get(PkiService).rotate({ id: 'sec.operator', role: 'SECURITY_OFFICER', correlationId: 'p9-trust' }, '회귀 키 교체', PUBLICATION_KEY_PURPOSE.POLICY);
    expect(cacheOf(await view())).toMatchObject({ status: 'VALID', use: 'CURRENT' });
    runtime.receive(VIN, first);
    expect(repo().get(VIN).log.at(-1)).toMatchObject({ result: 'REJECTED', detail: 'REPLAY' });
    expect(repo().get(VIN).highest[`flag:${FLAG}`]).toBe(first.payload.sequence);
  });
});
