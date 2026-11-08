// GX는 저장된 PASS 문자열만으로 출시/예외 완료를 판단하면 안 된다(FFG-LCY-001, 비우회 서명·무결성).
// 저장 근거 손상은 fixture 내부에서만 주입하고, 확인 대상은 실제 HTTP release-gate/deploy/만료 조회 경로다.
import type { INestApplication } from '@nestjs/common';
import type { DecisionProvenance, GateId, GateRecordRow } from '@ff/contracts';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Clock } from '../../src/kernel/clock';
import { DB, type Db } from '../../src/kernel/db';
import { GateRepo } from '../../src/domains/d01-policy/repos';
import { GateDecisionService } from '../../src/domains/d01-policy/topology/gate-decision.service';
import { actor, bootApp, confirmSafety, signG7, withRef } from '../helpers';

Object.assign(process.env, {
  FF_SCHEDULER: 'manual',
  GLEO_MODE: 'internal',
  CARLA_RUNNER: resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'),
  FF_EVIDENCE_DIR: mkdtempSync(join(tmpdir(), 'ff-gx-trust-')),
});
afterAll(() => {
  for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'CARLA_RUNNER', 'FF_EVIDENCE_DIR']) delete process.env[k];
});

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const RELEASE = actor('usr-coordinator', 'RELEASE_MANAGER');
const FSM = actor('usr-quality', 'SAFETY_OFFICER');
const OPSLEAD = actor('usr-opslead', 'OPS_LEAD');
const VERSION = '0.1.0';
const T0 = '2026-10-12T01:00:00.000Z';
const EXPIRES = '2026-10-12T02:00:00.000Z';
type TrustCase = 'MISSING' | 'INVALID' | 'WITHDRAWN_KEY' | DecisionProvenance;

describe('GX 출시·예외 완료의 Gate Decision 신뢰도', () => {
  let app: INestApplication;
  let http: () => any;
  let fid: string;
  let pid: string;
  const featurePath = () => `/api/features/${fid}/versions/${VERSION}`;
  const db = () => app.get<Db>(DB);
  const decisions = () => app.get(GateDecisionService);

  beforeEach(async () => {
    ({ app, http } = await bootApp({ at: T0, showcaseFill: false }));
    const created = await http().post('/api/features').set(AUTHOR).send(withRef({ name: '서명 신뢰도 회귀 Feature', description: 'GX Gate Decision', requirementIds: ['REQ-GX-TRUST'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'] })).expect(201);
    fid = created.body.featureId;
    await http().patch(featurePath()).set(AUTHOR).send({ functions: [{ functionId: 'FUNC-000056', label: 'Extended Gap Control 기능' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] }).expect(200);
    await confirmSafety(http, fid, VERSION);
    for (const gate of ['G1', 'G2', 'G3']) await judge(gate);
    await http().post(`${featurePath()}/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' }).expect(200);
    await signG7(http, fid, VERSION);
    for (const gate of ['G4', 'G5', 'G6', 'G7']) await judge(gate);
    const policy = await http().post('/api/policies').set(AUTHOR).send({ featureId: fid, featureVersion: VERSION, controlPoint: 'Flag', flagKey: `care_${fid.slice(5)}_gxtrust`, description: '서명 신뢰도 시험 Flag', safeDefault: false }).expect(201);
    pid = policy.body.policyId;
    expect((await http().post(`/api/policies/${pid}/validate`).set(AUTHOR).send({}).expect(200)).body.run.decision).toBe('GO');
    const approved = await http().post(`/api/policies/${pid}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
    expect(approved.body.feature.lifecycle).toBe('VERIFIED');
  });
  afterEach(async () => app?.close());

  async function judge(gate: string) {
    await http().post(`${featurePath()}/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: '회귀 준비 판정', evidenceRef: `EV-GX-TRUST-${gate}` }).expect(201);
  }

  function releaseProof(kind: TrustCase) {
    const gates = app.get(GateRepo);
    const base = gates.latest(fid, VERSION).G7!;
    const added: GateRecordRow[] = [];
    db().tx(() => {
      for (const gate of ['G8', 'G9'] as GateId[]) {
        const record: GateRecordRow = { ...base, gate, gateRecordId: gates.nextId(gate), inputResult: 'PASS', status: 'PASS', rationale: '출시 판정', evidenceRef: `EV-GX-TRUST-${gate}` };
        gates.insert(record);
        added.push(record);
        if (kind !== 'MISSING') decisions().sign(record, { id: kind === 'IMPORT' ? null : 'choi.judge', role: 'GATE_JUDGE' }, kind === 'IMPORT' ? 'IMPORT' : 'PLATFORM');
      }
      if (kind === 'INVALID') for (const record of added) db().run('UPDATE gate_record SET doc = ? WHERE gate_record_id = ?', JSON.stringify({ ...record, evidenceRef: 'EV-GX-TAMPERED' }), record.gateRecordId);
      // 정상 rotate의 RETIRED 키는 검증용으로 남는다. 여기서는 신뢰앵커 회수 상황만 명시적으로 주입한다.
      if (kind === 'WITHDRAWN_KEY') db().run('DELETE FROM pki_key WHERE key_id = ?', decisions().get(added[0].gateRecordId)!.signature.kid);
    });
    const states = Object.fromEntries((['G8', 'G9'] as GateId[]).map(g => [g, decisions().verify(gates.latest(fid, VERSION)[g]!).state]));
    expect(Object.values(states)).toEqual([kind === 'MISSING' ? 'MISSING' : kind === 'PLATFORM' ? 'SIGNED' : kind === 'IMPORT' ? 'IMPORTED' : 'INVALID', kind === 'MISSING' ? 'MISSING' : kind === 'PLATFORM' ? 'SIGNED' : kind === 'IMPORT' ? 'IMPORTED' : 'INVALID']);
    return states;
  }

  async function pilot() {
    const request = await http().post('/api/exceptions').set(RELEASE).send({ kind: 'GATE_PENDING', featureId: fid, featureVersion: VERSION, gates: ['G8', 'G9'], restriction: 'PILOT', reason: '지정 차량 검증', periodHours: 1, dueDate: '2026-10-20', residualRisk: '운영 검증 미완' }).expect(201);
    const id = request.body.exceptionId;
    for (const who of [FSM, OPSLEAD]) await http().post(`/api/exceptions/${id}/decision`).set(who).send({ decision: 'APPROVE', reason: '제한 범위 확인', expiresAt: EXPIRES }).expect(200);
    expect((await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: 'Pilot 배포' }).expect(200)).body).toMatchObject({ stageBasisPoints: 100, exceptionScope: { exceptionIds: [id] } });
    return id;
  }

  for (const kind of ['MISSING', 'INVALID', 'WITHDRAWN_KEY'] as const) {
    it(`${kind}: raw PASS가 있어도 release-gate와 실제 배포를 허용하지 않는다`, async () => {
      const states = releaseProof(kind);
      const view = await http().get(`/api/policies/${pid}/release-gate`).expect(200);
      // 두 HTTP 요청을 먼저 실행하여 표시 오류의 첫 단언이 실제 제어 경로 재현을 가리지 않게 한다.
      const deployment = await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: '출시 배포' });
      console.info('GX_TRUST_HTTP', JSON.stringify({ kind, states, releaseAllowed: view.body.allowed, deployStatus: deployment.status, publicationId: deployment.body.publicationId ?? null, stageBasisPoints: deployment.body.stageBasisPoints ?? null }));
      expect(view.body.allowed).toBe(false);
      expect(deployment.status).toBe(422);
      expect(deployment.body.error.details.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'GATE_UNSIGNED' })]));
      expect((await http().get(`/api/policies/${pid}`).expect(200)).body.policy.status).toBe('APPROVED');
    });

    it(`${kind}: 활성 예외도 서명 실패를 덮지 못하고 제한과 0% 중단을 유지한다`, async () => {
      const id = await pilot();
      releaseProof(kind);
      const view = await http().get(`/api/policies/${pid}/release-gate`).expect(200);
      const wide = await http().post(`/api/policies/${pid}/rollout`).set(actor('usr-operator', 'OPERATOR')).send({ basisPoints: 500, reason: '범위 확대 시도' });
      const stop = await http().post(`/api/policies/${pid}/rollout`).set(RELEASE).send({ basisPoints: 0, reason: '안전 확인 전 중단' });
      expect(view.body.allowed).toBe(false);
      expect(wide.status).toBe(422);
      expect(wide.body.error.message).toMatch(/제한 범위/);
      expect(stop.status).toBe(200);
      expect(stop.body.stageBasisPoints).toBe(0);
      expect((await http().get(`/api/exceptions/${id}`).expect(200)).body.status).toBe('ACTIVE');
      const resume = await http().post(`/api/policies/${pid}/rollout`).set(actor('usr-operator', 'OPERATOR')).send({ basisPoints: 100, reason: 'Pilot 재개 시도' });
      console.info('GX_TRUST_RESUME', JSON.stringify({ kind, resumeStatus: resume.status, stageBasisPoints: resume.body.stageBasisPoints ?? null }));
      expect(resume.status).toBe(422);
      expect(resume.body.error.details.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'GATE_UNSIGNED' })]));
    });

    it(`${kind}: 신뢰할 수 없는 PASS로 예외를 완료하지 않고 만료 원복한다`, async () => {
      const id = await pilot();
      const states = releaseProof(kind);
      app.get(Clock).set('2026-10-12T02:00:01.000Z');
      await http().get('/api/exceptions?active=true').expect(200);
      const exception = (await http().get(`/api/exceptions/${id}`).expect(200)).body;
      const policy = (await http().get(`/api/policies/${pid}`).expect(200)).body.policy;
      console.info('GX_TRUST_EXPIRY', JSON.stringify({ kind, states, exceptionStatus: exception.status, stageBasisPoints: policy.stageBasisPoints, exceptionScope: policy.exceptionScope }));
      expect(exception.status).toBe('EXPIRED');
      expect(exception.history.map((h: any) => h.kind)).not.toContain('COMPLETED');
      expect(policy.stageBasisPoints).toBe(0);
    });
  }

  for (const swept of [false, true]) it(`만료한 Pilot은 예약 원복 ${swept ? '후에도' : '전에도'} 단계 조정으로 넓힐 수 없다`, async () => {
    await pilot();
    app.get(Clock).set('2026-10-12T02:00:01.000Z');
    if (swept) {
      await http().get('/api/exceptions?active=true').expect(200);
      expect((await http().get(`/api/policies/${pid}`).expect(200)).body.policy.stageBasisPoints).toBe(0);
    } else {
      await http().post(`/api/policies/${pid}/rollout`).set(RELEASE).send({ basisPoints: 0, reason: '만료 예외 중단' }).expect(200);
    }
    const resume = await http().post(`/api/policies/${pid}/rollout`).set(actor('usr-operator', 'OPERATOR')).send({ basisPoints: 100, reason: '만료 뒤 Pilot 재개 시도' });
    console.info('GX_EXPIRED_RESUME', JSON.stringify({ swept, resumeStatus: resume.status, stageBasisPoints: resume.body.stageBasisPoints ?? null }));
    expect(resume.status).toBe(422);
    expect(resume.body.error.details.code).toBe('EXCEPTION_INACTIVE');
  });

  for (const provenance of ['PLATFORM', 'IMPORT'] as const) {
    it(`${provenance}: 신뢰 가능한 PASS로는 정상 배포할 수 있다`, async () => {
      releaseProof(provenance);
      expect((await http().get(`/api/policies/${pid}/release-gate`).expect(200)).body.allowed).toBe(true);
      const deployment = await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: '검증된 근거로 배포' }).expect(200);
      expect(deployment.body).toMatchObject({ status: 'DEPLOYED', publicationId: expect.stringMatching(/^PUB-/) });
    });

    it(`${provenance}: 신뢰 가능한 PASS는 예외를 정상 완료한다`, async () => {
      const id = await pilot();
      releaseProof(provenance);
      await http().get('/api/exceptions?active=true').expect(200);
      const exception = (await http().get(`/api/exceptions/${id}`).expect(200)).body;
      const policy = (await http().get(`/api/policies/${pid}`).expect(200)).body.policy;
      expect(exception.status).toBe('COMPLETED');
      expect(policy.stageBasisPoints).toBe(100);
      expect(policy.exceptionScope).toBeNull();
      expect((await http().get(`/api/policies/${pid}/release-gate`).expect(200)).body.allowed).toBe(true);
    });
  }
});
