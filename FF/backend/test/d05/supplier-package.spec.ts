// P13 — 협력사 매핑·10산출물·본문 검증·검수 분리·G6. 참조 URI만 등록한 것을 검증 완료로 세지 않는다.
import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp, confirmSafety } from '../helpers';
import { FeatureRepo, GateRepo, TopologyRepo } from '../../src/domains/d01-policy/repos';
import { GateDecisionService } from '../../src/domains/d01-policy/topology/gate-decision.service';
import { LifecycleService } from '../../src/domains/d01-policy/registry/lifecycle.service';
import { DB, type Db } from '../../src/kernel/db';

const IMPL = actor('usr-supplier-impl', 'IMPLEMENTER');
const JUDGE = actor('usr-supplier-quality', 'GATE_JUDGE');
const SELF_JUDGE = actor('usr-supplier-impl', 'GATE_JUDGE');
const OPERATOR = actor('usr-supplier-ops', 'OPERATOR');
const ID = 'FEAT-00010';
const VER = '99.0.0';
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const TYPES = ['API_CONTRACT', 'HUMAN_DOC', 'FEATURE_MAPPING', 'CAPABILITY_MANIFEST', 'VARIANT_COMPAT', 'DIAGNOSTICS', 'SAFETY_SECURITY', 'SDK_STUB_MOCK', 'TEST_EVIDENCE', 'RELEASE_NOTE'];

describe('협력사 패키지 인수(P13)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    ({ app, http } = await bootApp());
    // 시험 대상 버전 — 기존 시드의 승인/검수와 독립된 개발 중 버전이다.
    const repo = app.get(FeatureRepo);
    const base = repo.get(ID, '2.0.0')!;
    repo.insert({ ...base, version: VER, lifecycle: 'DEVELOPING', baselineId: null, gateRecordIds: [] }, { createdBy: 'usr-supplier-impl', createdAt: '2026-11-08T00:00:00Z' });
    // G6 결함이 앞 단계/안전 분류에 가려지지 않게, 시험용 이관 근거를 명시적으로 봉인한다.
    const gates = app.get(GateRepo);
    const decisions = app.get(GateDecisionService);
    const db = app.get<Db>(DB);
    const prepare = (version: string) => db.tx(() => {
      for (const gate of ['G1', 'G2', 'G3', 'G4', 'G5'] as const) {
        const source = gates.all().find((r) => r.gate === gate)!;
        const row = { ...source, gateRecordId: gates.nextId(gate), featureId: ID, featureVersion: version, status: 'PASS' as const, inputResult: 'PASS' as const, evidenceRef: 'P13-TEST-IMPORTED', judgedAt: '2026-11-08T00:00:00+09:00' };
        gates.insert(row);
        decisions.sign(row, { id: null, role: row.judgeRole }, 'IMPORT');
      }
    });
    prepare(VER);
    await confirmSafety(http, ID, VER);
    const sw = { ...app.get(TopologyRepo).allSw()[0], swId: 'SW-INTERNAL-P13', version: '1.0.0', supplier: 'Internal' };
    db.run('INSERT INTO sw_master (sw_id, version, ecu_pno, doc) VALUES (?, ?, ?, ?)', sw.swId, sw.version, sw.ecuPno, JSON.stringify(sw));
    repo.insert({ ...base, version: '98.0.0', lifecycle: 'DEVELOPING', baselineId: null, gateRecordIds: [], swIds: [sw.swId], swVersions: [sw.version] }, { createdBy: 'usr-supplier-impl', createdAt: '2026-11-08T00:00:00Z' });
    prepare('98.0.0');
    await confirmSafety(http, ID, '98.0.0');
  });
  afterAll(() => app.close());

  it('조회는 Feature를 확인하고, 매핑 등록은 역할·동일 공급사 SW를 검사한다', async () => {
    await http().get('/api/supplier-mappings?featureId=FEAT-99999').expect(404);
    const body = { featureId: ID, supplier: 'Tier1-B', supplierFunctionId: 'DMS_P13_99', name: '운전자 상태 판단' };
    await http().post('/api/supplier-mappings').set(OPERATOR).send(body).expect(403);
    const map = (await http().post('/api/supplier-mappings').set(IMPL).send(body).expect(201)).body;
    await http().post('/api/supplier-mappings').set(IMPL).send(body).expect(409);
    await http().post(`/api/supplier-mappings/${map.mapId}/swcs`).set(IMPL).send({ swcId: 'HUD_WRONG', name: '다른 공급사 구성요소', swId: 'SW-HUD' }).expect(422);
    const linked = (await http().post(`/api/supplier-mappings/${map.mapId}/swcs`).set(IMPL).send({ swcId: 'DMS_APP', name: '운전자 상태 앱', swId: 'SW-DMS-APP', ecuPno: '95770-MX200' }).expect(201)).body;
    expect(linked.swcs).toEqual(expect.arrayContaining([expect.objectContaining({ swId: 'SW-DMS-APP' })]));
    const list = (await http().get(`/api/supplier-mappings?featureId=${ID}`).expect(200)).body;
    expect(list.items).toEqual(expect.arrayContaining([expect.objectContaining({ mapId: map.mapId, supplierFunctionId: 'DMS_P13_99' })]));
  });

  it('검수되지 않은 개발 버전은 G6 PASS 근거가 될 수 없다', async () => {
    const r = await http().post(`/api/features/${ID}/versions/${VER}/gates`).set(JUDGE).send({ gate: 'G6', inputResult: 'PASS', rationale: '협력사 검수 확인', evidenceRef: 'supplier-package:P13-missing' }).expect(422);
    expect(r.body.error.message).toMatch(/협력사|산출물|패키지/);
  });

  it('협력사 산출물 대상이 아닌 내부 개발 버전의 G6는 독립적으로 판정한다', async () => {
    const r = await http().post(`/api/features/${ID}/versions/98.0.0/gates`).set(JUDGE).send({ gate: 'G6', inputResult: 'PASS', rationale: '내부 개발 검증 완료', evidenceRef: 'INTERNAL-P13-TEST' }).expect(201);
    expect(r.body.record.status).toBe('PASS');
  });

  it('10항목·검증 본문·검수 기준·분리 승인을 모두 갖춘 뒤에만 합격하고 본문은 API로 다시 취득한다', async () => {
    const mapping = (await http().post('/api/supplier-mappings').set(IMPL).send({ featureId: ID, supplier: 'Tier1-B', supplierFunctionId: 'DMS_P13_PACKAGE', name: '패키지 검수 대상 기능' }).expect(201)).body;
    const pkg = (await http().post('/api/supplier-packages').set(IMPL).send({ featureId: ID, featureVersion: VER, supplier: 'Tier1-B', version: '99.0.0' }).expect(201)).body;
    await http().post('/api/supplier-packages').set(IMPL).send({ featureId: ID, featureVersion: VER, supplier: 'Tier1-B', version: '99.0.0' }).expect(409);
    await http().post(`/api/supplier-packages/${pkg.packageId}/artifacts`).set(IMPL).send({ type: 'HUMAN_DOC', title: '개발 문서', version: '99.0.0', uri: 'file:///C:/developer/package.md', checksum: sha('문서') }).expect(400);
    await http().post(`/api/supplier-packages/${pkg.packageId}/submit`).set(IMPL).send({ note: '산출물 누락 확인' }).expect(422);

    const metadata: Record<string, object> = {
      API_CONTRACT: { apiFormat: 'OPENAPI' },
      HUMAN_DOC: {},
      FEATURE_MAPPING: { mappingIds: [mapping.mapId] },
      CAPABILITY_MANIFEST: { capability: { hwVersions: ['B'], swVersions: [{ swId: 'SW-DMS-APP', version: '2.0.0' }, { swId: 'SW-DMS-SVC', version: '2.1.0' }], ecuCapabilities: [{ ecuPno: '95770-MX200', capabilities: ['운전자 상태 판단'] }] } },
      VARIANT_COMPAT: { variants: [{ vehicleModel: 'MX5', region: 'EU', trim: 'Premium', modelYears: [2026] }] },
      DIAGNOSTICS: { diagnostics: { dtcs: ['B1A2F'], events: ['DMS_DROWSY'] } },
      SAFETY_SECURITY: { safety: { asil: 'C', cybersecurityClaim: '검수용 보안 요구 대응', certRef: null } },
      SDK_STUB_MOCK: {},
      TEST_EVIDENCE: { testEvidence: { unitPassed: 20, unitTotal: 20, integrationPassed: 10, integrationTotal: 10, coveragePct: 85, buildStatus: 'SUCCESS', buildWarnings: 0, evidenceIds: ['P13-T1'] } },
      RELEASE_NOTE: { releaseNote: { releaseId: 'REL-P13-99', breakingChanges: false, migration: null } },
    };
    const binding = { featureId: ID, featureVersion: VER, packageVersion: '99.0.0' };
    const text = (type: string) => JSON.stringify(type === 'API_CONTRACT' ? { openapi: '3.2.0', info: { title: '운전자 상태 API', version: '99.0.0' }, paths: {}, 'x-ff-package': binding } : { title: `${type} 서버 보관본`, package: binding, ...metadata[type] });
    const artifact = (type: string, withBody: boolean) => ({ type, title: `${type} 산출물`, version: '99.0.0', uri: `https://supplier.example/releases/P13/${type}`, checksum: sha(text(type)), ...(withBody ? { text: text(type) } : {}), ...metadata[type] });
    for (const type of TYPES) await http().post(`/api/supplier-packages/${pkg.packageId}/artifacts`).set(IMPL).send(artifact(type, false)).expect(201);
    await http().post('/api/supplier-criteria').set(JUDGE).send({ featureId: ID, reason: '검증 본문과 실행 근거 확인', items: [{ kind: 'MIN_COVERAGE', threshold: 80 }, { kind: 'ALL_TESTS_PASS' }, { kind: 'BUILD_CLEAN', threshold: 0 }, { kind: 'ASIL_COVERS_FEATURE' }, { kind: 'VARIANT_COVERS_FEATURE' }, { kind: 'CAPABILITY_COVERS_SW' }, { kind: 'BREAKING_HAS_MIGRATION' }] }).expect(201);
    const submitted = (await http().post(`/api/supplier-packages/${pkg.packageId}/submit`).set(IMPL).send({ note: '참조만 수집한 상태' }).expect(200)).body;
    expect(submitted.check.verdict).toBe('NOT_MET');
    expect(submitted.check.packaging).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'PKG_INTEGRITY', result: 'NOT_EVALUABLE' })]));
    const review = (decision: string) => ({ decision, comment: decision === 'ACCEPT' ? '10항목과 기준을 확인했습니다' : '검증 본문을 보완해 주세요', items: TYPES.map((type) => ({ type, result: 'PASS' })) });
    await http().post(`/api/supplier-packages/${pkg.packageId}/reviews`).set(SELF_JUDGE).send(review('ACCEPT')).expect(403);
    await http().post(`/api/supplier-packages/${pkg.packageId}/reviews`).set(JUDGE).send(review('ACCEPT')).expect(422);
    await http().post(`/api/supplier-packages/${pkg.packageId}/reviews`).set(JUDGE).send(review('REJECT')).expect(201);
    let saved: any;
    for (const type of TYPES) saved = (await http().post(`/api/supplier-packages/${pkg.packageId}/artifacts`).set(IMPL).send(artifact(type, true)).expect(201)).body;
    expect(saved.integrity).toBe('VERIFIED');
    const downloaded = (await http().get(`/api/supplier-artifacts/${saved.recordId}/content`).expect(200)).body;
    expect(downloaded).toMatchObject({ text: text('RELEASE_NOTE'), checksum: sha(text('RELEASE_NOTE')), verified: true });
    await http().post(`/api/supplier-packages/${pkg.packageId}/submit`).set(IMPL).send({ note: '서버 검증 본문 보완' }).expect(200);
    const accepted = (await http().post(`/api/supplier-packages/${pkg.packageId}/reviews`).set(JUDGE).send(review('ACCEPT')).expect(201)).body;
    expect(accepted.package.status).toBe('ACCEPTED');
    expect(accepted.review.checkVerdict).toBe('MET');
    const gate = await http().post(`/api/features/${ID}/versions/${VER}/gates`).set(JUDGE).send({ gate: 'G6', inputResult: 'PASS', rationale: '협력사 10항목 검수 완료', evidenceRef: `supplier-package:${pkg.packageId}` }).expect(201);
    expect(gate.body.record.status).toBe('PASS');
    await http().post(`/api/supplier-packages/${pkg.packageId}/artifacts`).set(IMPL).send(artifact('HUMAN_DOC', true)).expect(409);
    const detail = (await http().get(`/api/supplier-packages/${pkg.packageId}`).expect(200)).body;
    expect(detail.reviews.map((r: any) => r.decision)).toEqual(['REJECT', 'ACCEPT']);
    expect(detail.artifacts).toHaveLength(20);
  });

  it('검수 기준이 바뀌면 이전 G6 기록을 보존하면서 현재 전이 근거를 보류한다', async () => {
    await http().post('/api/supplier-criteria').set(JUDGE).send({ featureId: ID, reason: '시험 커버리지 기준 상향', items: [{ kind: 'MIN_COVERAGE', threshold: 99 }] }).expect(201);
    expect(app.get(GateRepo).latest(ID, VER).G6?.status).toBe('PASS');
    const f = app.get(FeatureRepo).get(ID, VER)!;
    expect(app.get(LifecycleService).context(f).latestGates.G6).toBe('검토 중');
    const release = app.get(LifecycleService).options({ ...f, lifecycle: 'VERIFIED' }).find((o) => o.to === 'RELEASED')!;
    expect(release.blockers.some((b) => b.ref === 'G6' && b.message.includes('협력사'))).toBe(true);
    const facts = (await http().get('/api/features/' + ID + '/versions/' + VER + '/supplier-gate').expect(200)).body;
    expect(facts.blockers).toHaveLength(1);
  });
});
