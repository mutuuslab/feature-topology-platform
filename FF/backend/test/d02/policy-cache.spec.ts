// 차량 정책 캐시(P9) — 차량 시뮬레이터(D02-03)가 받아 둔 서명 정책을 쓰기 전에 다시 확인한다.
// FR-LPC-001-003 유효 기간 필드·만료 식별 · FR-LPC-002-003 만료 → Safe Default 위임·기록 · FR-LPC-002-004 위임 사유·Feature·시각 기록
// FR-LPC-003-001 사용 전 서명 재검증 · FR-LPC-003-002 저장 해시 ↔ 재계산 비교 · FR-LPC-003-003 손상 캐시 제외·직전 캐시 대체·Safe Default
// FR-RTE-001-003 수신 때 필드·유효 기간 파싱(형식 오류·이미 만료 거부) · FR-RTE-002-004 로컬 실행 결과(정책 판·사용 캐시) · FR-RTE-004-003 차량 쪽 차단 이력
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', CARLA_RUNNER: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-cache-')) });
import { PUBLICATION_KEY_PURPOSE, type Publication } from '@ff/contracts';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VehicleRuntimeService } from '../../src/domains/d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { PkiService } from '../../src/domains/d06-qsec/pki-kms/pki.service';
import { RuntimeRepo } from '../../src/domains/d06-qsec/secure-deploy/publication.repo';
import { Clock } from '../../src/kernel/clock';
import { Scheduler } from '../../src/kernel/scheduler';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const VIN = 'ego-01';
const FLAG = 'care_00022_param';
const DAY = 86_400_000;

describe('차량 정책 캐시 — 유효 기간·사용 전 확인·손상 대체·Safe Default 위임', () => {
  let app: INestApplication;
  let http: () => any;
  let runtime: VehicleRuntimeService;
  let first: Publication;
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
    runtime = app.get(VehicleRuntimeService);
  });
  afterAll(async () => {
    await app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'CARLA_RUNNER', 'FF_EVIDENCE_DIR']) delete process.env[k];
  });
  const advance = (ms: number) => {
    const clock = app.get(Clock);
    const until = clock.now().getTime() + ms;
    app.get(Scheduler).flush(ms);
    clock.set(new Date(until));
  };
  const view = async () => (await http().get(`/api/vehicles/${VIN}/runtime`).expect(200)).body;
  const cacheOf = (v: any) => v.cache.find((c: any) => c.flagKey === FLAG);
  /** 받은 게시본을 같은 키로 다시 서명한 다음 판(순번 +1, 같은 게시본 ID — 회신은 그 게시본으로 간다). 정책 판을 올려 직전 캐시와 구별한다 */
  const nextPub = (base: Publication, patch: Record<string, unknown> = {}): Publication => {
    const payload = { ...base.payload, sequence: base.payload.sequence + 1, policy: { ...base.payload.policy!, revision: base.payload.policy!.revision + 1 }, ...patch } as Publication['payload'];
    return { ...base, payload, signature: app.get(PkiService).sign(payload, PUBLICATION_KEY_PURPOSE.POLICY) };
  };

  it('정책 게시본에 유효 기간(validUntil, 서명 payload 안)이 있고, 차량 캐시가 그 값과 상태(VALID)를 보인다', async () => {
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey: FLAG, description: '캐시 시험', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: c.body.policyId }).expect(201);
    await http().post(`/api/policies/${c.body.policyId}/validate`).set(AUTHOR).send({}).expect(200);
    await http().post(`/api/policies/${c.body.policyId}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
    const id = (await http().post(`/api/policies/${c.body.policyId}/deploy`).set(RELEASE).send({ reason: '배포' }).expect(200)).body.publicationId;
    advance(3_000);
    first = (await http().get(`/api/publications/${id}`).expect(200)).body.publication;
    expect(first.payload.validUntil).toBe(new Date(Date.parse(first.payload.issuedAt) + 90 * DAY).toISOString());
    const v = await view();
    expect(cacheOf(v)).toMatchObject({ flagKey: FLAG, featureId: 'FEAT-00022', publicationId: id, validUntil: first.payload.validUntil, status: 'VALID', use: 'CURRENT', delegation: null, excluded: null });
    // 로컬 실행 결과 — 정책 판(게시본·순번)과 쓴 캐시가 평가 결과와 함께 남는다
    expect(v.evaluations.find((e: any) => e.flagKey === FLAG)).toMatchObject({ local: { value: true, reason: 'POLICY_MATCH' }, cache: { use: 'CURRENT', publicationId: id, sequence: first.payload.sequence } });
  });

  it('수신 때 파싱 — 유효 기간 형식이 틀리거나 이미 지난 게시본은 서명이 맞아도 적용하지 않는다(MALFORMED·EXPIRED, 순번을 쓰지 않음)', async () => {
    runtime.receive(VIN, nextPub(first, { validUntil: 'not-a-date' }));
    runtime.receive(VIN, nextPub(first, { validUntil: new Date(Date.parse(first.payload.issuedAt) + 1).toISOString() }));
    const v = await view();
    expect(v.runtime.log.slice(-2).map((l: any) => [l.result, l.detail])).toEqual([
      ['REJECTED', 'MALFORMED'],
      ['REJECTED', 'EXPIRED'],
    ]);
    expect(v.runtime.highest[`flag:${FLAG}`]).toBe(first.payload.sequence);
    expect(cacheOf(v).publicationId).toBe(first.publicationId);
  });

  it('새 판을 받으면 직전 판을 직전 캐시로 남긴다 — 현재 캐시가 저장 뒤 손상되면 빼고 직전 정상 캐시로 평가(무결성 위반 기록·표시)', async () => {
    const second = nextPub(first, { policy: { ...first.payload.policy!, revision: first.payload.policy!.revision + 1, enabled: true } });
    runtime.receive(VIN, second);
    expect(cacheOf(await view())).toMatchObject({ sequence: second.payload.sequence, use: 'CURRENT', previous: 'VALID', previousCache: { publicationId: first.publicationId, status: 'VALID' } });
    // 저장소 손상 — 차량이 쓰기 전에 다시 계산한 해시가 저장 해시와 다르다
    const repo = app.get(RuntimeRepo);
    const s = repo.get(VIN);
    (s.bundles[FLAG] as any).payload.policy.enabled = false;
    repo.save(s);
    const v = await view();
    expect(cacheOf(v)).toMatchObject({ status: 'INTEGRITY_MISMATCH', use: 'PREVIOUS', delegation: null, excluded: 'CACHE_INTEGRITY_MISMATCH' });
    expect(v.evaluations.find((e: any) => e.flagKey === FLAG)).toMatchObject({ local: { value: true }, cache: { use: 'PREVIOUS', sequence: first.payload.sequence } });
    const log = v.runtime.log.at(-1);
    expect(log).toMatchObject({ result: 'CACHE_EXCLUDED', detail: 'CACHE_INTEGRITY_MISMATCH', featureId: 'FEAT-00022', flagKey: FLAG, publicationId: second.publicationId });
    // 같은 상태로 다시 보면 같은 기록을 반복하지 않는다
    expect((await view()).runtime.log.length).toBe(v.runtime.log.length);
  });

  it('직전 캐시까지 손상되면 Safe Default로 위임하고 사유·Feature·시각을 남긴다(서버 판단과 어긋남으로 보인다)', async () => {
    const repo = app.get(RuntimeRepo);
    const s = repo.get(VIN);
    (s.bundles[FLAG] as any).previous.signature.signature = Buffer.from('forged').toString('base64').padEnd(88, 'A');
    repo.save(s);
    const v = await view();
    expect(cacheOf(v)).toMatchObject({ use: 'SAFE_DEFAULT', delegation: 'CACHE_INTEGRITY_MISMATCH', previous: 'SIGNATURE_INVALID' });
    const e = v.evaluations.find((x: any) => x.flagKey === FLAG);
    expect(e.local).toMatchObject({ value: false, decision: 'SAFE_DEFAULT', reason: 'ERROR_SAFE_DEFAULT' });
    expect(e.drift).toBe(true);
    expect(v.runtime.log.at(-1)).toMatchObject({ result: 'SAFE_DEFAULT', detail: 'CACHE_INTEGRITY_MISMATCH', featureId: 'FEAT-00022', flagKey: FLAG, at: expect.any(String) });
  });

  it('유효 기간이 지나면 정상 캐시도 Safe Default 위임(CACHE_EXPIRED) — 새 게시본을 받으면 다시 현재 캐시', async () => {
    const third = nextPub(first, { sequence: first.payload.sequence + 5 });
    runtime.receive(VIN, third);
    expect(cacheOf(await view())).toMatchObject({ status: 'VALID', use: 'CURRENT' });
    advance(91 * DAY);
    const v = await view();
    expect(cacheOf(v)).toMatchObject({ status: 'EXPIRED', use: 'SAFE_DEFAULT', delegation: 'CACHE_EXPIRED' });
    // 이 차량의 다른 정책 캐시도 같이 만료된다 — 이 Flag의 기록을 본다
    expect(v.runtime.log.findLast((l: any) => l.flagKey === FLAG)).toMatchObject({ result: 'SAFE_DEFAULT', detail: 'CACHE_EXPIRED', featureId: 'FEAT-00022' });
    expect(v.evaluations.find((x: any) => x.flagKey === FLAG).local.decision).toBe('SAFE_DEFAULT');
  });

  it('차량 쪽 차단 이력 — 런타임 기록 중 차단·복원만 따로 보인다(FR-RTE-004-003)', async () => {
    const v = await view();
    expect(Array.isArray(v.killHistory)).toBe(true);
    expect(v.killHistory.every((l: any) => l.kind === 'KILL' || l.kind === 'RESTORE')).toBe(true);
  });
});
