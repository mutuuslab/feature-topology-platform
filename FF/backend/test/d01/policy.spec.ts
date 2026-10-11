// PoC ② 정책 준비·검증·승인 · ③ 사용 권한·서버 활성화 판단 · IF-10 OFREP — API로 끝까지 검증한다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const OPERATOR = actor('seo.ops', 'OPERATOR');

describe('정책 파이프라인 · 활성화 판단 · OFREP', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    ({ app, http } = await bootApp());
    app.get(Clock).set('2026-10-12T01:00:00.000Z'); // 체험권 유효기간(2026-10-01~31) 안
  });
  afterAll(() => app.close());

  const decide = (vin: string, flagKey = 'care_00022_param') => http().get(`/api/activation/decide?vin=${vin}&flagKey=${flagKey}`).expect(200);

  describe('PoC ③ 서버 활성화 판단 (시드: FEAT-00022 정책 2건 배포, 체험권 CAT-00019)', () => {
    it('배포 정책 2건 (Signal·Parameter)', async () => {
      const r = await http().get('/api/policies?featureId=FEAT-00022').expect(200);
      expect(r.body.items.map((p: any) => [p.flagKey, p.status])).toEqual([['care_00022_signal', 'DEPLOYED'], ['care_00022_param', 'DEPLOYED']]);
    });

    it.each([
      ['ego-01', true, 'POLICY_MATCH'], // 1회 체험권 유효
      ['KMH-NX4-0001', true, 'POLICY_MATCH'], // 구독 CAT-00013 (FEAT-00022 포함)
      ['KMH-NX4-0002', false, 'NO_ENTITLEMENT'],
      ['lead-01', false, 'NO_ENTITLEMENT'], // 체험권 이미 사용
      ['KMH-NX4-0003', false, 'CONTEXT_UNKNOWN'], // STALE → HOLD → Safe Default(OFF)
      ['TMA-NX4-0001', false, 'NOT_APPLICABLE'], // EU
    ])('%s → %s (%s)', async (vin, value, reason) => {
      const r = await decide(vin);
      expect(r.body.result).toMatchObject({ value, reason });
      expect(r.body.result.trace.length).toBeGreaterThan(2);
    });

    it('PoC ⑤ 체험 수락 → 1회 체험권 사용 → 다시 판단하면 권한 없음', async () => {
      await http().post('/api/entitlements/ENT-00001/consume').set(JUDGE).send({}).expect(403); // 운영자·시스템만
      const c = await http().post('/api/entitlements/ENT-00001/consume').set(OPERATOR).send({}).expect(200);
      expect(c.body).toMatchObject({ usesLeft: 0, status: 'CONSUMED' });
      await http().post('/api/entitlements/ENT-00001/consume').set(OPERATOR).send({}).expect(422);
      expect((await decide('ego-01')).body.result).toMatchObject({ value: false, reason: 'NO_ENTITLEMENT' });
      const ev = await http().get('/api/events?type=entitlement.consumed').expect(200);
      expect(ev.body.items.at(-1)).toMatchObject({ aggregate: 'ego-01', payload: { grantId: 'ENT-00001', usesLeft: 0 } });
    });
  });

  describe('OFREP (IF-10) — 행위자 헤더 없는 SDK 호출', () => {
    it('단일 평가: OpenFeature 사유·변형·메타데이터', async () => {
      const r = await http().post('/ofrep/v1/evaluate/flags/care_00022_param').send({ context: { targetingKey: 'KMH-NX4-0001' } }).expect(200);
      expect(r.body).toMatchObject({ key: 'care_00022_param', value: true, variant: 'on', reason: 'TARGETING_MATCH', metadata: { decision: 'ALLOW' } });
    });
    it('오류는 OFREP 규격: 키 누락 400, 미등록 차량 400, 없는 flag 404', async () => {
      expect((await http().post('/ofrep/v1/evaluate/flags/care_00022_param').send({ context: {} }).expect(400)).body.errorCode).toBe('TARGETING_KEY_MISSING');
      expect((await http().post('/ofrep/v1/evaluate/flags/care_00022_param').send({ context: { targetingKey: 'NOPE' } }).expect(400)).body.errorCode).toBe('INVALID_CONTEXT');
      expect((await http().post('/ofrep/v1/evaluate/flags/nope_flag').send({ context: { targetingKey: 'ego-01' } }).expect(404)).body.errorCode).toBe('FLAG_NOT_FOUND');
    });
    it('일괄 평가: ETag, 같으면 304', async () => {
      const a = await http().post('/ofrep/v1/evaluate/flags').send({ context: { targetingKey: 'KMH-NX4-0001' } }).expect(200);
      expect(a.body.flags.map((f: any) => f.key)).toEqual(['care_00022_param', 'care_00022_signal']);
      await http().post('/ofrep/v1/evaluate/flags').set('If-None-Match', a.headers.etag).send({ context: { targetingKey: 'KMH-NX4-0001' } }).expect(304);
    });
  });

  describe('PoC ② 정책 작성 → 8종 병렬 검증 → 배포 안전성 → 승인 → Feature VERIFIED 자동 전이 → 배포', () => {
    let fid: string;
    let pid: string;
    const spec = () => ({ featureId: fid, featureVersion: '0.1.0', controlPoint: 'Flag', flagKey: `care_${fid.slice(5)}_flag`, description: '시험 Flag', safeDefault: false, enabled: true });

    it('Feature 준비: 등록 → 구현 연결 → G1~G3 → 승인(자동 DEVELOPING) → G4~G7 PASS여도 정책이 없어 DEVELOPING', async () => {
      const f = await http().post('/api/features').set(AUTHOR).send({ name: '정책 시험 Feature', description: 'P7', requirementIds: ['REQ-P7-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'] }).expect(201);
      fid = f.body.featureId;
      await http().patch(`/api/features/${fid}/versions/0.1.0`).set(AUTHOR).send({ functions: [{ functionId: 'FUNC-000056', label: 'Extended Gap Control 기능' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] }).expect(200);
      for (const g of ['G1', 'G2', 'G3']) await http().post(`/api/features/${fid}/versions/0.1.0/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
      await http().post(`/api/features/${fid}/versions/0.1.0/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' }).expect(200);
      for (const g of ['G4', 'G5', 'G6', 'G7']) await http().post(`/api/features/${fid}/versions/0.1.0/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
      const d = await http().get(`/api/features/${fid}/versions/0.1.0`).expect(200);
      expect(d.body.feature.lifecycle).toBe('DEVELOPING');
      expect(d.body.transitions.find((t: any) => t.to === 'VERIFIED').blockers.map((b: any) => b.code)).toEqual(['POLICY_MISSING']);
    });

    it('정책 작성(DRAFT) → 검증: 8종 결과가 모두 오고 판정 GO → VALIDATED', async () => {
      const c = await http().post('/api/policies').set(AUTHOR).send(spec()).expect(201);
      pid = c.body.policyId;
      expect(c.body).toMatchObject({ status: 'DRAFT', revision: 1, contentHash: expect.stringMatching(/^sha256:/) });
      const v = await http().post(`/api/policies/${pid}/validate`).set(AUTHOR).send({}).expect(200);
      expect(v.body.run.results.map((r: any) => r.componentId)).toEqual(['D06-01', 'D03-01', 'D06-03', 'D06-06', 'D06-02', 'D06-05', 'D04-02', 'D06-07']);
      expect(v.body.run.results.every((r: any) => r.result === 'PASS')).toBe(true);
      expect(v.body.run.decision).toBe('GO');
      expect(v.body.policy.status).toBe('VALIDATED');
      const h = await http().get(`/api/policies/validations?policyId=${pid}`).expect(200);
      expect(h.body.items).toHaveLength(1);
    });

    it('검증 후 내용을 바꾸면 해시·개정본이 달라져 승인 불가 → 재검증 후 승인', async () => {
      await http().patch(`/api/policies/${pid}`).set(AUTHOR).send({ description: '시험 Flag (수정)' }).expect(200);
      const r = await http().post(`/api/policies/${pid}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: '승인' }).expect(422);
      expect(r.body.error.details.blockers.join(' ')).toMatch(/검증 이후 정책 내용이 바뀌었습니다/);
      await http().post(`/api/policies/${pid}/validate`).set(AUTHOR).send({}).expect(200);
    });

    it('작성자 본인은 승인 불가 (P0 SELF_APPROVAL)', async () => {
      const self = actor('kim.author', 'FEATURE_APPROVER');
      const r = await http().post(`/api/policies/${pid}/decision`).set(self).send({ decision: 'APPROVE', reason: '셀프' }).expect(403);
      expect(r.body.error.code).toBe('SEPARATION_OF_DUTY');
    });

    it('승인 → Control Point 정책 커버리지 충족 → Feature가 같은 트랜잭션에서 VERIFIED로 자동 전이', async () => {
      const r = await http().post(`/api/policies/${pid}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: '8종 GO 확인' }).expect(200);
      expect(r.body.policy.status).toBe('APPROVED');
      expect(r.body.feature).toMatchObject({ featureId: fid, lifecycle: 'VERIFIED' });
    });

    it('배포 → OFREP·활성화 판단에 반영 (권한 불필요 정책)', async () => {
      await http().post(`/api/policies/${pid}/deploy`).set(JUDGE).send({ reason: '배포' }).expect(403);
      await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: '서버 배포' }).expect(200);
      const r = await http().post(`/ofrep/v1/evaluate/flags/${spec().flagKey}`).send({ context: { targetingKey: 'KMH-NX4-0002' } }).expect(200);
      expect(r.body).toMatchObject({ value: true, reason: 'TARGETING_MATCH' });
    });

    it('단계적 배포: 승인 범위 안에서만 — 0%면 COHORT_MISS, 코호트 목록은 FP-COHORT-1', async () => {
      await http().post(`/api/policies/${pid}/rollout`).set(RELEASE).send({ basisPoints: 0, reason: '일시 중단' }).expect(200);
      expect((await decide('KMH-NX4-0002', spec().flagKey)).body.result.reason).toBe('COHORT_MISS');
      await http().post(`/api/policies/${pid}/rollout`).set(RELEASE).send({ basisPoints: 5000, reason: '50% 확대' }).expect(200);
      const c = await http().get(`/api/targeting/cohort?flagKey=${spec().flagKey}`).expect(200);
      expect(c.body).toMatchObject({ basisPoints: 5000, algorithm: 'FP-COHORT-1' });
      for (const v of c.body.vehicles) expect(v.inCohort).toBe(v.bucket < 5000);
    });

    it('배포 정책 수정은 불가(IMMUTABLE) — 새 정책으로', async () => {
      await http().patch(`/api/policies/${pid}`).set(AUTHOR).send({ description: 'x' }).expect(409);
    });

    it('ASIL B Feature에 Safe Default ON 정책은 컴플라이언스 FAIL → BLOCKED', async () => {
      const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Signal', flagKey: 'care_00022_signal_v2', description: '위험', safeDefault: true }).expect(201);
      const v = await http().post(`/api/policies/${c.body.policyId}/validate`).set(AUTHOR).send({}).expect(200);
      expect(v.body.run.decision).toBe('BLOCKED');
      expect(v.body.run.results.find((r: any) => r.componentId === 'D03-01').result).toBe('FAIL');
      expect(v.body.policy.status).toBe('DRAFT');
    });
  });
});
