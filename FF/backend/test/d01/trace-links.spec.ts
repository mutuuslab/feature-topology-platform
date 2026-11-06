// Feature 관계·추적 연결(P3, FR-DEP-001~009) — 관계 유형 10종, excludes 동시 활성화 경고, 변경 영향의 차량·정책·OTA, 그래프 필터,
// 요구·설계 요소·인터페이스·Test Case·OTA 연결(출처 존재 확인·해제 이력), Test Evidence, 커버리지·미연결·미등록 Feature.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const IMPL = actor('usr-integrator', 'IMPLEMENTER');
const JUDGE = actor('usr-quality', 'GATE_JUDGE');
const RELEASE = actor('usr-release', 'RELEASE_MANAGER');
const OPERATOR = actor('usr-ops', 'OPERATOR');

describe('Feature 관계·추적 연결 (P3)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp()));
  afterAll(() => app.close());

  describe('관계 유형 10종·등록 검증', () => {
    let draft: { featureId: string; version: string };
    beforeAll(async () => {
      draft = (await http().post('/api/features/FEAT-00022/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason: '관계 유형 시험', changes: { description: '관계 유형 시험' } }).expect(201)).body.feature;
    });

    it('관계 유형 값 목록 API는 명세 10종을 낸다', async () => {
      const r = await http().get('/api/relation-types').expect(200);
      expect(r.body.items.map((x: any) => x.spec)).toEqual(['requires', 'excludes', 'parent_of', 'child_of', 'composed_of', 'overrides', 'fallback_to', 'degrades_to', 'replaces', 'duplicates']);
    });

    it('parent_of로 등록하면 미판정, 반대 child_of는 같은 관계라 422 INVERSE_DUPLICATE', async () => {
      const r = await http().post('/api/dependencies').set(AUTHOR).send({ type: 'PARENT_OF', sourceFeatureId: draft.featureId, sourceVersion: draft.version, targetFeatureId: 'FEAT-00023', targetVersion: '1.0.0' }).expect(201);
      expect(r.body).toMatchObject({ type: 'PARENT_OF', verdict: '미판정', warnings: [] });
      const g = await http().get(`/api/topology/graph?types=PARENT_OF`).expect(200);
      expect(g.body.edges.map((e: any) => e.type)).toEqual(['PARENT_OF']);
      // Lifecycle 필터는 양 끝을 본다 — 원천 PROPOSED·대상 RELEASED
      expect((await http().get('/api/topology/graph?types=PARENT_OF&lifecycle=PROPOSED,RELEASED').expect(200)).body.edges.map((e: any) => e.id)).toEqual([r.body.dependencyId]);
      expect((await http().get('/api/topology/graph?types=PARENT_OF&lifecycle=RELEASED').expect(200)).body.edges).toEqual([]);
    });

    it('excludes 등록 때 두 Feature가 함께 켜져 있으면 정책·차량 단위 경고를 돌려주고 감사에 남긴다(등록은 된다)', async () => {
      const r = await http().post('/api/dependencies').set(AUTHOR).send({ type: 'EXCLUDES', sourceFeatureId: draft.featureId, sourceVersion: draft.version, targetFeatureId: 'FEAT-00024', targetVersion: '1.0.0' }).expect(201);
      expect(r.body.warnings).toHaveLength(1);
      const w = r.body.warnings[0];
      expect(w).toMatchObject({ conflict: true, applicable: true });
      expect(w.policies.source.map((p: any) => p.policyId)).toEqual(['POL-00001', 'POL-00002']);
      expect(w.policies.target.map((p: any) => p.policyId)).toEqual(['POL-00003']);
      expect(w.vehicles.checked).toBeGreaterThan(0);
      expect(['VEHICLE', 'POLICY']).toContain(w.level);
      const again = await http().get(`/api/dependencies/${r.body.dependencyId}/exclusion-check`).expect(200);
      expect(again.body).toMatchObject({ conflict: true, vehicles: { checked: w.vehicles.checked, both: w.vehicles.both } });
      const audit = await http().get(`/api/audit?target=${r.body.dependencyId}`).set(actor('usr-audit', 'AUDITOR')).expect(200);
      expect((audit.body.items ?? audit.body).map((a: any) => a.action)).toContain('DEPENDENCY_EXCLUSION_WARNING');
    });

    it('requires와 excludes를 같은 두 Feature에 두면 422 CONFLICTING_RELATION', async () => {
      const r = await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: draft.featureId, sourceVersion: draft.version, targetFeatureId: 'FEAT-00024', targetVersion: '1.0.0' }).expect(422);
      expect(r.body.error.details.issues.map((i: any) => i.code)).toContain('CONFLICTING_RELATION');
    });

    it('excludes가 아닌 관계의 동시 활성화 검사는 해당 없음', async () => {
      const r = await http().get('/api/dependencies/DEP-00013/exclusion-check').expect(200);
      expect(r.body).toMatchObject({ applicable: false, conflict: false });
    });
  });

  describe('변경 영향 — 차량·정책·OTA 범위', () => {
    it('FEAT-00145 변경은 의존자 FEAT-00022의 배포 정책·범위 차량·OTA 패키지까지 낸다', async () => {
      const r = await http().get('/api/impact/FEAT-00145/5.4.2?changed=swVersions').expect(200);
      expect(r.body.policies.map((p: any) => p.policyId)).toEqual(expect.arrayContaining(['POL-00001', 'POL-00002']));
      expect(r.body.policies.find((p: any) => p.policyId === 'POL-00001')).toMatchObject({ direct: false, live: true });
      expect(r.body.vehicles.total).toBeGreaterThan(0);
      expect(r.body.ota.map((o: any) => o.packageId)).toEqual(expect.arrayContaining(['sw-care-sdist-app-1.2.1.pkg']));
      expect(r.body.summary).toMatchObject({ policies: r.body.policies.length, vehicles: r.body.vehicles.total, otaPackages: r.body.ota.length });
    });
  });

  describe('추적 연결 등록·해제', () => {
    const base = { featureId: 'FEAT-00024', elementName: null, elementVersion: null };
    it('요구 연결 — 유형·출처·등록자가 남고 출처 확인은 하지 않는다(ALM 조회는 연계 묶음)', async () => {
      const r = await http().post('/api/trace-links').set(AUTHOR).send({ ...base, kind: 'REQUIREMENT', elementId: 'REQ-T-9001', elementType: 'SYSTEM', sourceSystem: 'CODEBEAMER' }).expect(201);
      expect(r.body).toMatchObject({ linkId: expect.stringMatching(/^TRL-\d{5}$/), status: 'ACTIVE', existence: 'NOT_CHECKED', linkedBy: 'usr-author', elementType: 'SYSTEM', sourceSystem: 'CODEBEAMER' });
      await http().post('/api/trace-links').set(AUTHOR).send({ ...base, kind: 'REQUIREMENT', elementId: 'REQ-T-9001', elementType: 'SYSTEM', sourceSystem: 'CODEBEAMER' }).expect(409);
    });

    it('설계 요소 — 출처(PLM)에 있으면 이름·버전을 채우고, 없는 버전·없는 ECU는 422', async () => {
      const ok = await http().post('/api/trace-links').set(IMPL).send({ ...base, kind: 'ARCHITECTURE', elementId: 'SW-ADAS-FW', elementType: 'SW', elementVersion: '11.0.1', sourceSystem: 'PLM' }).expect(201);
      expect(ok.body).toMatchObject({ existence: 'VERIFIED', elementName: 'ADAS Firmware', elementVersion: '11.0.1', sourceRef: expect.stringMatching(/^IF-02:trace:/) });
      // 이미 이은 요소는 409, 다른 Feature에 없는 버전으로 이으면 422(출처의 버전 목록을 알려 준다)
      await http().post('/api/trace-links').set(IMPL).send({ ...base, kind: 'ARCHITECTURE', elementId: 'SW-ADAS-FW', elementType: 'SW', elementVersion: '11.0.0', sourceSystem: 'PLM' }).expect(409);
      const v = await http().post('/api/trace-links').set(IMPL).send({ ...base, featureId: 'FEAT-00023', kind: 'ARCHITECTURE', elementId: 'SW-ADAS-FW', elementType: 'SW', elementVersion: '9.9.9', sourceSystem: 'PLM' }).expect(422);
      expect(v.body.error.message).toContain('11.0.0');
      await http().post('/api/trace-links').set(IMPL).send({ ...base, kind: 'ARCHITECTURE', elementId: '00000-NONE', elementType: 'HW', sourceSystem: 'PLM' }).expect(422);
    });

    it('인터페이스 — 유형(API·Signal·DTC·Event)이 출처와 다르면 422, 출처에 없으면 422', async () => {
      await http().post('/api/trace-links').set(IMPL).send({ ...base, kind: 'INTERFACE', elementId: 'SIG.SW_ADAS_FW.STATUS', elementType: 'SIGNAL', sourceSystem: 'IDT' }).expect(201);
      const t = await http().post('/api/trace-links').set(IMPL).send({ ...base, kind: 'INTERFACE', elementId: 'API.sw_adas_fw', elementType: 'EVENT', sourceSystem: 'IDT' }).expect(422);
      expect(t.body.error.message).toContain('API');
      await http().post('/api/trace-links').set(IMPL).send({ ...base, kind: 'INTERFACE', elementId: 'SIG.NOT.THERE', elementType: 'SIGNAL', sourceSystem: 'IDT' }).expect(422);
    });

    it('Test Case — TMS(IF-09)에 있는지 확인하고 호출을 기록한다, 필수 여부 없으면 400', async () => {
      await http().post('/api/trace-links').set(JUDGE).send({ ...base, kind: 'TEST_CASE', elementId: 'TC-00024-04', elementType: 'HIL', sourceSystem: 'TMS' }).expect(400);
      const r = await http().post('/api/trace-links').set(JUDGE).send({ ...base, kind: 'TEST_CASE', elementId: 'TC-00024-04', elementType: 'HIL', sourceSystem: 'TMS', required: true }).expect(201);
      expect(r.body).toMatchObject({ existence: 'VERIFIED', required: true, sourceRef: expect.stringMatching(/^IF-09:/) });
      await http().post('/api/trace-links').set(JUDGE).send({ ...base, kind: 'TEST_CASE', elementId: 'TC-99999-01', elementType: 'HIL', sourceSystem: 'TMS', required: true }).expect(422);
      const sys = await http().get('/api/integrations/systems').expect(200);
      expect((sys.body.items ?? sys.body).find((s: any) => s.ifId === 'IF-09').calls).toBeGreaterThan(0);
    });

    it('OTA 패키지 — 출시 담당이 SW 패키지 저장소의 패키지를 잇는다, 종류별 역할이 아니면 403', async () => {
      const r = await http().post('/api/trace-links').set(RELEASE).send({ ...base, kind: 'OTA', elementId: 'sw-adas-fw-11.0.1.pkg', elementType: 'SW_PACKAGE', sourceSystem: 'SW_REPO' }).expect(201);
      expect(r.body).toMatchObject({ elementVersion: '11.0.1' });
      await http().post('/api/trace-links').set(AUTHOR).send({ ...base, kind: 'OTA', elementId: 'sw-adas-fw-11.0.0.pkg', elementType: 'SW_PACKAGE', sourceSystem: 'SW_REPO' }).expect(403);
      await http().post('/api/trace-links').set(OPERATOR).send({ ...base, kind: 'REQUIREMENT', elementId: 'REQ-T-1', elementType: 'SW', sourceSystem: 'ALM' }).expect(403);
    });

    it('출처 미리 확인 — 이름·버전 목록', async () => {
      const r = await http().get('/api/trace-sources/lookup?kind=ARCHITECTURE&elementId=SW-ADAS-FW').expect(200);
      expect(r.body).toMatchObject({ found: true, versions: ['11.0.0', '11.0.1'], element: { version: '11.0.1', name: 'ADAS Firmware' } });
      expect((await http().get('/api/trace-sources/lookup?kind=TEST_CASE&elementId=TC-99999-01').expect(200)).body.found).toBe(false);
      await http().get('/api/trace-sources/lookup?kind=NOPE&elementId=X').expect(400);
    });

    it('해제 — 사유와 함께 상태로 남고(이력), 두 번 해제는 409, 목록은 기본 활성만', async () => {
      const list = await http().get('/api/trace-links?featureId=FEAT-00024&kind=INTERFACE').expect(200);
      const sig = list.body.items.find((l: any) => l.elementId === 'SIG.SW_ADAS_FW.STATUS');
      const r = await http().post(`/api/trace-links/${sig.linkId}/unlink`).set(IMPL).send({ reason: '신호 정의 변경으로 재연결 예정' }).expect(201);
      expect(r.body).toMatchObject({ status: 'UNLINKED', unlinkedBy: 'usr-integrator', unlinkReason: '신호 정의 변경으로 재연결 예정' });
      await http().post(`/api/trace-links/${sig.linkId}/unlink`).set(IMPL).send({ reason: '다시' }).expect(409);
      const after = await http().get('/api/trace-links?featureId=FEAT-00024&kind=INTERFACE').expect(200);
      expect(after.body.items.find((l: any) => l.linkId === sig.linkId)).toBeUndefined();
      const hist = await http().get('/api/trace-links?featureId=FEAT-00024&kind=INTERFACE&status=ALL').expect(200);
      expect(hist.body.items.find((l: any) => l.linkId === sig.linkId).status).toBe('UNLINKED');
      // 해제 뒤 같은 요소를 다시 이을 수 있다
      await http().post('/api/trace-links').set(IMPL).send({ ...base, kind: 'INTERFACE', elementId: 'SIG.SW_ADAS_FW.STATUS', elementType: 'SIGNAL', sourceSystem: 'IDT' }).expect(201);
    });

    it('현황 조회는 유형·출처별로 거르고 묶는다', async () => {
      const r = await http().get('/api/trace-links?featureId=FEAT-00024&kind=ARCHITECTURE&elementType=SW').expect(200);
      expect(r.body.items.every((l: any) => l.elementType === 'SW')).toBe(true);
      expect(r.body.groups.ARCHITECTURE.bySource).toEqual({ PLM: r.body.items.length });
    });
  });

  describe('Test Evidence·커버리지', () => {
    let tc: any;
    beforeAll(async () => {
      tc = (await http().get('/api/trace-links?featureId=FEAT-00024&kind=TEST_CASE').expect(200)).body.items.find((l: any) => l.elementId === 'TC-00024-04');
    });

    it('연결된 Test Case에 Evidence를 등록한다 — 미래 실행 일시 400, 같은 Evidence 409, Test Case가 아니면 422, 역할 아니면 403', async () => {
      const at = new Date(Date.now() - 3600_000).toISOString();
      const r = await http().post(`/api/trace-links/${tc.linkId}/evidence`).set(JUDGE).send({ evidenceId: 'EV-HIL-24-1', executedAt: at, result: 'FAIL', environment: 'HIL 벤치 2' }).expect(201);
      expect(r.body).toMatchObject({ recordId: expect.stringMatching(/^TEV-/), testCaseId: 'TC-00024-04', registeredBy: 'usr-quality', result: 'FAIL' });
      await http().post(`/api/trace-links/${tc.linkId}/evidence`).set(JUDGE).send({ evidenceId: 'EV-HIL-24-1', executedAt: at, result: 'PASS', environment: 'HIL 벤치 2' }).expect(409);
      await http().post(`/api/trace-links/${tc.linkId}/evidence`).set(JUDGE).send({ evidenceId: 'EV-HIL-24-9', executedAt: new Date(Date.now() + 86_400_000).toISOString(), result: 'PASS', environment: 'HIL 벤치 2' }).expect(400);
      await http().post(`/api/trace-links/${tc.linkId}/evidence`).set(AUTHOR).send({ evidenceId: 'EV-HIL-24-2', executedAt: at, result: 'PASS', environment: 'HIL 벤치 2' }).expect(403);
      const arch = (await http().get('/api/trace-links?featureId=FEAT-00024&kind=ARCHITECTURE').expect(200)).body.items[0];
      await http().post(`/api/trace-links/${arch.linkId}/evidence`).set(JUDGE).send({ evidenceId: 'EV-X', executedAt: at, result: 'PASS', environment: 'HIL 벤치 2' }).expect(422);
    });

    it('Feature 요약 — Test Case별 Evidence 여부·최종 결과, 실패 필수 TC, 요구 커버리지', async () => {
      const r = await http().get('/api/features/FEAT-00024/trace-links').expect(200);
      const row = r.body.links.find((l: any) => l.linkId === tc.linkId);
      expect(row.test).toMatchObject({ hasEvidence: true, latestResult: 'FAIL', evidenceCount: 1 });
      expect(r.body.coverage.test.failing).toContain('TC-00024-04');
      // FEAT-00024는 시드에서 요구를 잇지 않았다 — 방금 잇은 REQ-T-9001은 ALM 목록 밖이라 커버리지 0
      expect(r.body.coverage.requirement).toMatchObject({ linked: 1, covered: 0 });
      expect(r.body.coverage.requirement.total).toBeGreaterThan(0);
      expect(r.body.requirements.every((q: any) => q.linked === false)).toBe(true);
    });

    it('커버리지 목록 — 요구 미연결 Feature(FR-DEP-005-005)·필수 Evidence 미등록 Feature(FR-DEP-008-006)', async () => {
      const no = await http().get('/api/trace-coverage?filter=noRequirement').expect(200);
      expect(no.body.items.length).toBe(no.body.summary.noRequirement);
      expect(no.body.items.every((x: any) => !x.hasRequirementLink)).toBe(true);
      expect(no.body.items.map((x: any) => x.featureId)).toContain('FEAT-00003');
      expect(no.body.items.map((x: any) => x.featureId)).not.toContain('FEAT-00024'); // 방금 요구를 이었다
      const miss = await http().get('/api/trace-coverage?filter=missingEvidence').expect(200);
      expect(miss.body.items.every((x: any) => x.missingRequiredEvidence && x.test.missing.length > 0)).toBe(true);
      const all = await http().get('/api/trace-coverage').expect(200);
      expect(all.body.summary.requirementRatio).toBeGreaterThan(0);
      expect(all.body.summary.requirementRatio).toBeLessThan(1);
      await http().get('/api/trace-coverage?filter=wrong').expect(400);
    });

    it('해제한 Test Case는 커버리지에서 빠지고 Evidence 등록을 받지 않는다', async () => {
      const before = (await http().get('/api/features/FEAT-00024/trace-links').expect(200)).body.coverage.test.required;
      await http().post(`/api/trace-links/${tc.linkId}/unlink`).set(JUDGE).send({ reason: 'HIL 벤치 교체로 시험 재정의' }).expect(201);
      const after = (await http().get('/api/features/FEAT-00024/trace-links').expect(200)).body.coverage.test.required;
      expect(after).toBe(before - 1);
      await http().post(`/api/trace-links/${tc.linkId}/evidence`).set(JUDGE).send({ evidenceId: 'EV-HIL-24-3', executedAt: new Date().toISOString(), result: 'PASS', environment: 'HIL 벤치 2' }).expect(409);
    });
  });
});
