// P10 Lifecycle·Gate·즉시 폐기·Baseline 보강 — Gate 4상태·Go/No-Go·자동 검사·N/A 승인, 정의 승인 반려·검증 재작업 기록,
// 즉시 폐기(요청자 ≠ 승인자, Retired 관문), Feature 변경 이력·Baseline 조회·비교·ChangeSet, 출시 후보 통합 스냅샷.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp, confirmSafety, withRef } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const AUTHOR_AS_APPROVER = actor('kim.author', 'FEATURE_APPROVER');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const SAFETY = actor('usr-safety', 'SAFETY_OFFICER');
const SAFETY2 = actor('usr-safety2', 'SAFETY_OFFICER');
const RELEASE = actor('usr-coordinator', 'RELEASE_MANAGER');
const OWNER = actor('usr-author', 'FEATURE_AUTHOR');
const BOM = actor('jung.bom', 'BOM_APPROVER');

describe('P10 Lifecycle·Gate 보강', () => {
  let app: INestApplication;
  let http: () => any;
  let qm: string;
  const judge = (id: string, ver: string, gate: string, inputResult = 'PASS', who = JUDGE) =>
    http().post(`/api/features/${id}/versions/${ver}/gates`).set(who).send({ gate, inputResult, rationale: `${gate} 검토`, evidenceRef: `EV-P10-${gate}-${inputResult}` });
  const create = async (name: string, asil = 'QM') =>
    (await http().post('/api/features').set(AUTHOR).send(withRef({ name, description: `${name} 시험`, requirementIds: ['REQ-P10-001'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil, upgVc: ['F111A114001'], controlPoints: ['Flag'] })).expect(201)).body.featureId as string;

  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-18T01:00:00.000Z' }));
    qm = await create('P10 해당 없음 시험');
    await confirmSafety(http, qm, '0.1.0');
  });
  afterAll(async () => app?.close());

  describe('Gate 4상태·Go/No-Go·자동 검사 (FR-REG-005-008·009·016)', () => {
    it('출시된 FEAT-00022 1.0.0 — 9 Gate PASS면 Go, 명세 상태값·Gate별 자동 검사를 함께 준다', async () => {
      const g = (await http().get('/api/features/FEAT-00022/versions/1.0.0/gates').expect(200)).body;
      expect(g.goNoGo).toMatchObject({ result: 'GO', failed: [], open: [] });
      expect(g.gates.map((x: any) => x.specStatus)).toEqual(Array(9).fill('PASS'));
      expect(g.gates.find((x: any) => x.gate === 'G4').checks.map((c: any) => c.key)).toEqual(['SAFE_DEFAULT', 'ROLLBACK_PLAN', 'KILL_READY']);
      expect(g.checks.map((c: any) => c.gate)).toEqual(expect.arrayContaining(['G1', 'G3', 'G4', 'G5', 'G8', 'G9']));
    });

    it('FAIL이 1건이면 No-Go — CONDITIONAL은 PENDING(판정 중)', async () => {
      await judge(qm, '0.1.0', 'G1').expect(201);
      await judge(qm, '0.1.0', 'G2', 'CONDITIONAL').expect(201);
      let g = (await http().get(`/api/features/${qm}/versions/0.1.0/gates`).expect(200)).body;
      expect(g.goNoGo.result).toBe('PENDING');
      expect(g.gates.find((x: any) => x.gate === 'G2').specStatus).toBe('PENDING');
      await judge(qm, '0.1.0', 'G2', 'FAIL').expect(201);
      g = (await http().get(`/api/features/${qm}/versions/0.1.0/gates`).expect(200)).body;
      expect(g.goNoGo).toMatchObject({ result: 'NO_GO', failed: ['G2'] });
      await judge(qm, '0.1.0', 'G2').expect(201);
    });

    it('requires 대상이 출시 전이면 정의 승인이 G1 자동 검사로 막힌다 (FR-REG-005-001)', async () => {
      const src = await create('P10 필요 관계 원천');
      await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: src, sourceVersion: '0.1.0', targetFeatureId: qm, targetVersion: '0.1.0' }).expect(201);
      const d = (await http().get(`/api/features/${src}/versions/0.1.0`).set(APPROVER).expect(200)).body;
      const b = d.transitions.find((t: any) => t.to === 'APPROVED').blockers;
      expect(b).toContainEqual(expect.objectContaining({ code: 'GATE_CHECK_FAILED', ref: 'G1:REQUIRES_RELEASED' }));
    });
  });

  describe('해당 없음(N/A) 요청·승인 (FR-REG-005-008·013)', () => {
    it('G1은 N/A로 둘 수 없다 — 422', async () => {
      const r = await http().post(`/api/features/${qm}/versions/0.1.0/gate-na-requests`).set(JUDGE).send({ gate: 'G1', reason: '해당 기능 아님 시험' }).expect(422);
      expect(r.body.error.message).toMatch(/모든 Feature에 해당/);
    });

    it('G3 N/A — 요청자는 승인할 수 없고(403 직무 분리), 다른 Safety Manager가 승인하면 N/A 기록(사유·승인자 서명)', async () => {
      const req = (await http().post(`/api/features/${qm}/versions/0.1.0/gate-na-requests`).set(SAFETY).send({ gate: 'G3', reason: '차량 사양 구분이 없는 공통 기능 — Variant 판정 대상 아님' }).expect(201)).body;
      expect(req).toMatchObject({ requestId: expect.stringMatching(/^GNA-\d{5}$/), status: 'PENDING', requestedBy: 'usr-safety' });
      await http().post(`/api/features/${qm}/versions/0.1.0/gate-na-requests`).set(JUDGE).send({ gate: 'G3', reason: '같은 Gate 중복 요청' }).expect(409);
      await http().post(`/api/gate-na-requests/${req.requestId}/decision`).set(SAFETY).send({ decision: 'APPROVE', reason: '셀프' }).expect(403);
      await http().post(`/api/gate-na-requests/${req.requestId}/decision`).set(JUDGE).send({ decision: 'APPROVE', reason: '판정자' }).expect(403);
      const d = (await http().post(`/api/gate-na-requests/${req.requestId}/decision`).set(SAFETY2).send({ decision: 'APPROVE', reason: '공통 기능 확인' }).expect(200)).body;
      expect(d.request).toMatchObject({ status: 'APPROVED', decidedBy: 'usr-safety2', gateRecordId: expect.stringMatching(/^SIM-G3-\d{6}$/) });
      expect(d.record).toMatchObject({ status: 'N/A', inputResult: 'N/A', evidenceRef: req.requestId });
      const g = (await http().get(`/api/features/${qm}/versions/0.1.0/gates`).expect(200)).body;
      const g3 = g.gates.find((x: any) => x.gate === 'G3');
      expect(g3).toMatchObject({ status: 'N/A', specStatus: 'N/A' });
      expect(g3.decision.state).not.toMatch(/MISSING|INVALID/);
      expect(g.goNoGo.notApplicable).toEqual(['G3']);
      expect(g.naRequests[0]).toMatchObject({ status: 'APPROVED' });
      // N/A는 정의 승인의 Gate 조건을 막지 않는다
      const t = (await http().get(`/api/features/${qm}/versions/0.1.0`).set(APPROVER).expect(200)).body.transitions.find((x: any) => x.to === 'APPROVED');
      expect(t.blockers.filter((b: any) => b.ref === 'G3')).toEqual([]);
    });
  });

  describe('정의 승인 반려·검증 재작업 기록 (FR-REG-002-010·011·013)', () => {
    let rid: string;
    beforeAll(async () => (rid = await create('P10 반려 시험')));

    it('작성자는 반려할 수 없다(직무 분리), 이슈 항목 없는 반려는 400', async () => {
      await http().post(`/api/features/${rid}/versions/0.1.0/rejection`).set(AUTHOR_AS_APPROVER).send({ reason: '셀프 반려', issues: [{ item: '요구 누락' }], reworkReason: '보완' }).expect(403);
      await http().post(`/api/features/${rid}/versions/0.1.0/rejection`).set(APPROVER).send({ reason: '요구 누락', issues: [], reworkReason: '보완' }).expect(400);
    });

    it('승인자가 반려하면 PROPOSED에 머물고 반려 기록(사유·반려자·일시·이슈·재작업 사유)과 감사가 남는다', async () => {
      const r = (await http().post(`/api/features/${rid}/versions/0.1.0/rejection`).set(APPROVER).send({ reason: '요구사항 근거 부족', issues: [{ item: '요구 ID 출처 미확인', detail: 'REQ-P10-001 codeBeamer 미등록' }], reworkReason: '요구 출처 연결 뒤 재요청' }).expect(201)).body;
      expect(r).toMatchObject({ recordId: expect.stringMatching(/^FRV-\d{5}$/), kind: 'REJECT', from: 'PROPOSED', to: 'PROPOSED', by: 'lee.approver', reworkReason: '요구 출처 연결 뒤 재요청' });
      expect((await http().get(`/api/features/${rid}/versions/0.1.0`).expect(200)).body.feature.lifecycle).toBe('PROPOSED');
      const list = (await http().get(`/api/features/${rid}/reviews`).expect(200)).body.items;
      expect(list.map((x: any) => x.kind)).toEqual(['REJECT']);
      const a = (await http().get(`/api/audit?target=${rid}@0.1.0&action=FEATURE_REJECT`).expect(200)).body.items;
      expect(a[0]).toMatchObject({ actorId: 'lee.approver', reason: '요구사항 근거 부족' });
    });

    it('검증 이슈로 VERIFIED → DEVELOPING 되돌림은 이슈 항목 필수, 재작업 기록이 남는다', async () => {
      const v = (await http().get('/api/features?lifecycle=VERIFIED').expect(200)).body.items.find((f: any) => f.featureId !== 'FEAT-00001');
      await http().post(`/api/features/${v.featureId}/versions/${v.version}/transitions`).set(JUDGE).send({ to: 'DEVELOPING', reason: '회귀 오류' }).expect(422);
      await http().post(`/api/features/${v.featureId}/versions/${v.version}/transitions`).set(JUDGE).send({ to: 'DEVELOPING', reason: '회귀 오류 재작업', issues: [{ item: '정차 중 경고 누락', detail: 'TC 회귀' }] }).expect(200);
      const list = (await http().get(`/api/features/${v.featureId}/reviews?version=${v.version}`).expect(200)).body.items;
      expect(list.at(-1)).toMatchObject({ kind: 'REWORK', from: 'VERIFIED', to: 'DEVELOPING', issues: [{ item: '정차 중 경고 누락' }], reworkReason: '회귀 오류 재작업' });
    });
  });

  describe('즉시 폐기 (FR-REG-002-014~016, FR-REG-005-017·018)', () => {
    it('어느 단계든 폐기 요청 — 요청자·작성자는 승인할 수 없고, 다른 승인자가 승인하면 RETIRED·사유·요청자·승인자 기록', async () => {
      const id = await create('P10 즉시 폐기 시험');
      const r = (await http().post(`/api/features/${id}/versions/0.1.0/retire-requests`).set(AUTHOR).send({ reason: '사업 취소 — 개발 중단' }).expect(201)).body;
      expect(r).toMatchObject({ requestId: expect.stringMatching(/^FRT-\d{5}$/), from: 'PROPOSED', status: 'PENDING', requestedBy: 'kim.author' });
      await http().post(`/api/features/${id}/versions/0.1.0/retire-requests`).set(AUTHOR).send({ reason: '중복 요청 시험' }).expect(409);
      await http().post(`/api/feature-retire-requests/${r.requestId}/decision`).set(AUTHOR_AS_APPROVER).send({ decision: 'APPROVE', reason: '셀프' }).expect(403);
      expect((await http().get(`/api/features/${id}/versions/0.1.0`).expect(200)).body.feature.lifecycle).toBe('PROPOSED');
      const d = (await http().post(`/api/feature-retire-requests/${r.requestId}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: '사업 취소 확인' }).expect(200)).body;
      expect(d.request).toMatchObject({ status: 'APPROVED', decidedBy: 'lee.approver' });
      expect(d.feature.lifecycle).toBe('RETIRED');
      const a = (await http().get(`/api/audit?target=${id}@0.1.0&action=FEATURE_TRANSITION PROPOSED→RETIRED`).expect(200)).body.items;
      expect(a[0].reason).toMatch(/요청 kim\.author, 승인 lee\.approver/);
      await http().post(`/api/features/${id}/versions/0.1.0/retire-requests`).set(AUTHOR).send({ reason: '이미 폐기됨 시험' }).expect(422);
    });

    it('배포 중 Flag가 있는 출시 Version은 Flag Retirement 전에는 폐기할 수 없다 — Retired 관문 422', async () => {
      const p = (await http().get('/api/policies').expect(200)).body.items.find((x: any) => x.status === 'DEPLOYED');
      expect(p).toBeTruthy();
      const r = (await http().post(`/api/features/${p.featureId}/versions/${p.featureVersion}/retire-requests`).set(RELEASE).send({ reason: '단종 차종 — 기능 종료' }).expect(201)).body;
      const d = await http().post(`/api/feature-retire-requests/${r.requestId}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: '종료 승인' }).expect(422);
      expect(d.body.error.details.blockers).toContainEqual(expect.objectContaining({ code: 'RETIREMENT_INCOMPLETE', message: expect.stringContaining(p.flagKey) }));
      // 반려는 관문과 관계없이 할 수 있다
      await http().post(`/api/feature-retire-requests/${r.requestId}/decision`).set(APPROVER).send({ decision: 'REJECT', reason: 'Flag 정리 뒤 다시 요청' }).expect(200);
      expect((await http().get(`/api/feature-retire-requests?featureId=${p.featureId}`).expect(200)).body.items[0].status).toBe('REJECTED');
    });
  });

  describe('변경 이력·Baseline·출시 후보 통합 스냅샷 (FR-REG-003-002·003, 004-002~004, 005-015)', () => {
    it('없는 Feature ID는 404, 변경자·기간·변경 항목으로 걸러지고 일치 없음은 빈 목록', async () => {
      await http().get('/api/features/FEAT-99999/history').expect(404);
      const all = (await http().get(`/api/features/${qm}/history`).expect(200)).body.items;
      expect(all.length).toBeGreaterThan(2);
      const byJudge = (await http().get(`/api/features/${qm}/history?actorId=choi.judge`).expect(200)).body.items;
      expect(byJudge.length).toBeGreaterThan(0);
      expect(byJudge.every((x: any) => x.actorId === 'choi.judge')).toBe(true);
      expect((await http().get(`/api/features/${qm}/history?item=FEATURE_CREATE`).expect(200)).body.items.map((x: any) => x.action)).toEqual(['FEATURE_CREATE']);
      expect((await http().get(`/api/features/${qm}/history?from=2099-01-01`).expect(200)).body.items).toEqual([]);
      await http().get(`/api/features/${qm}/history?from=not-a-date`).expect(400);
    });

    it('Feature ID로 Baseline 목록(없는 ID 404), 임의 두 Baseline 비교 → 변경 유형·영역·항목', async () => {
      await http().get('/api/features/FEAT-99999/baselines').expect(404);
      const mine = (await http().get('/api/features/FEAT-00022/baselines').expect(200)).body.items;
      expect(mine.map((b: any) => b.baselineId)).toContain('BL-00028');
      expect(mine.every((b: any) => b.verified)).toBe(true);
      const all = (await http().get('/api/baselines').expect(200)).body.items;
      const other = all.find((b: any) => b.featureId !== 'FEAT-00022');
      const c = (await http().get(`/api/baselines/compare?left=BL-00028&right=${other.baselineId}`).expect(200)).body;
      expect(c.sameFeature).toBe(false);
      expect(c.items.length).toBeGreaterThan(0);
      expect(c.items[0]).toMatchObject({ type: expect.stringMatching(/ADDED|REMOVED|MODIFIED/), area: expect.any(String), field: expect.any(String) });
      expect((await http().get('/api/baselines/compare?left=BL-00028&right=BL-00028').expect(200)).body.items).toEqual([]);
      await http().get('/api/baselines/compare?left=BL-00028').expect(400);
      await http().get('/api/baselines/compare?left=BL-00028&right=BL-99999').expect(404);
    });

    it('Baseline 확정 때 ChangeSet(직전 Baseline 대비 변경 유형·영역·항목·일시)이 남는다', async () => {
      // Control Point 없는 Feature는 정의 승인 뒤 APPROVED에 머문다 — 첫 Baseline 확정
      const id = (await http().post('/api/features').set(AUTHOR).send(withRef({ name: 'P10 Baseline 시험', description: 'ChangeSet 시험', requirementIds: ['REQ-P10-002'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: [] })).expect(201)).body.featureId;
      await confirmSafety(http, id, '0.1.0');
      for (const g of ['G1', 'G2', 'G3']) await judge(id, '0.1.0', g).expect(201);
      await http().post(`/api/features/${id}/versions/0.1.0/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '정의 확인' }).expect(200);
      const v = { featureId: id, version: '0.1.0' };
      const q = (await http().post('/api/baselines/requests').set(AUTHOR).send({ featureId: v.featureId, version: v.version, reason: 'P10 ChangeSet 시험' }).expect(201)).body;
      const d = await http().post(`/api/baselines/requests/${q.requestId}/decision`).set(BOM).send({ decision: 'APPROVE', reason: '확정' }).expect(200);
      const cs = (await http().get(`/api/baselines/changesets?featureId=${v.featureId}`).expect(200)).body.items;
      expect(cs.at(-1)).toMatchObject({ changesetId: expect.stringMatching(/^BCS-\d{5}$/), fromBaselineId: null, toBaselineId: d.body.baseline.baselineId, at: expect.any(String), by: 'jung.bom' });
      expect(cs.at(-1).items.find((x: any) => x.field === 'requirementIds')).toMatchObject({ type: 'ADDED', area: 'REQUIREMENT', added: ['REQ-P10-002'] });
    });

    it('출시 승인 시점에 Feature·요구·Variant·정책·Test Evidence 통합 스냅샷이 해시와 함께 남는다', async () => {
      const base = '/api/features/FEAT-00001/versions/2.1.0';
      expect((await http().get(`${base}/release-candidate`).expect(200)).body.snapshot).toBeNull();
      await http().get('/api/features/FEAT-99999/versions/1.0.0/release-candidate').expect(404);
      await confirmSafety(http, 'FEAT-00001', '2.1.0');
      for (const g of ['G8', 'G9']) await judge('FEAT-00001', '2.1.0', g).expect(201);
      await http().post(`${base}/release-signoff`).set(OWNER).send({ reason: '출시 책임 확인 — 통합 스냅샷 시험' }).expect(201);
      await http().post(`${base}/transitions`).set(RELEASE).send({ to: 'RELEASED', reason: '출시' }).expect(200);
      const rc = (await http().get(`${base}/release-candidate`).expect(200)).body;
      expect(rc.verified).toBe(true);
      expect(rc.snapshot).toMatchObject({ rcbId: expect.stringMatching(/^RCB-\d{5}$/), featureId: 'FEAT-00001', version: '2.1.0', contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/), createdBy: 'usr-coordinator' });
      expect(Object.keys(rc.snapshot.content).sort()).toEqual(['baselineId', 'feature', 'policies', 'requirements', 'testEvidence', 'variant']);
      expect(rc.snapshot.content.testEvidence.gates).toHaveLength(9);
      expect((await http().get('/api/release-candidates?featureId=FEAT-00001').expect(200)).body.items).toHaveLength(1);
    });
  });

  describe('초안 삭제 — Feature Version·관계 (FR-REG-001-013·014, FR-DEP-001-005)', () => {
    const del = (id: string, ver: string, who = AUTHOR) => http().delete(`/api/features/${id}/versions/${ver}`).set(who).send({ reason: '잘못 등록한 초안' });
    it('작성자만, 승인 이력·참조가 없는 PROPOSED 초안만 지운다 — 묘비·감사가 남고 같은 ID는 다시 주지 않는다', async () => {
      const id = await create('P10 삭제 시험');
      await http().delete(`/api/features/${id}/versions/0.1.0`).set(actor('park.author', 'FEATURE_AUTHOR')).send({ reason: '남의 초안' }).expect(403);
      await http().delete(`/api/features/${id}/versions/0.1.0`).set(APPROVER).send({ reason: '권한 없음' }).expect(403);
      const t = (await del(id, '0.1.0').expect(200)).body;
      expect(t).toMatchObject({ entity: 'feature-version', recordId: `${id}@0.1.0`, deletedBy: 'kim.author', reason: '잘못 등록한 초안' });
      await http().get(`/api/features/${id}/versions/0.1.0`).expect(404);
      expect((await http().get('/api/deleted-drafts?entity=feature-version').expect(200)).body.items.map((x: any) => x.recordId)).toContain(`${id}@0.1.0`);
      expect((await http().get(`/api/audit?target=${id}@0.1.0&action=FEATURE_VERSION_DRAFT_DELETE`).expect(200)).body.items.some((x: any) => x.result === 'ALLOWED' && x.reason === '잘못 등록한 초안')).toBe(true);
      const next = await create('P10 삭제 뒤 새 등록');
      expect(Number(next.slice(5))).toBeGreaterThan(Number(id.slice(5)));
    });

    it('Gate PASS(승인 이력)가 있으면 409 — 폐기 표시로 안내, 출시 Version은 초안이 아님', async () => {
      const id = await create('P10 삭제 거부 시험');
      await judge(id, '0.1.0', 'G1').expect(201);
      const r = await del(id, '0.1.0').expect(409);
      expect(r.body.error.details).toMatchObject({ code: 'DRAFT_HAS_APPROVAL', alternative: 'RETIRE' });
      const g = await del('FEAT-00022', '1.0.0', actor('usr-author', 'FEATURE_AUTHOR')).expect(409);
      expect(g.body.error.details.code).toBe('DRAFT_NOT_DRAFT');
    });

    it('관계가 참조하는 초안은 409 — 원천 초안의 관계를 먼저 지우면 Feature도 지울 수 있다', async () => {
      const target = await create('P10 삭제 대상');
      const src = await create('P10 삭제 원천');
      const dep = (await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: src, sourceVersion: '0.1.0', targetFeatureId: target, targetVersion: '0.1.0' }).expect(201)).body;
      const r = await del(target, '0.1.0').expect(409);
      expect(r.body.error.details).toMatchObject({ code: 'DRAFT_REFERENCED', alternative: 'MARK_UNUSED', references: [{ kind: '관계', id: dep.dependencyId }] });
      await http().delete(`/api/dependencies/${dep.dependencyId}`).set(APPROVER).send({ reason: '권한 없음' }).expect(403);
      expect((await http().delete(`/api/dependencies/${dep.dependencyId}`).set(AUTHOR).send({ reason: '잘못 맺은 관계' }).expect(200)).body).toMatchObject({ entity: 'feature-relation', recordId: dep.dependencyId });
      expect((await http().get(`/api/features/${src}/versions/0.1.0`).expect(200)).body.feature.dependencyIds).not.toContain(dep.dependencyId);
      await del(target, '0.1.0').expect(200);
      // 원천이 승인된 관계는 초안이 아니다
      const released = (await http().get('/api/dependencies').expect(200)).body.items.find((d: any) => d.sourceFeatureId === 'FEAT-00022');
      expect((await http().delete(`/api/dependencies/${released.dependencyId}`).set(AUTHOR).send({ reason: '출시 관계 삭제 시도' }).expect(409)).body.error.details.code).toBe('DRAFT_NOT_DRAFT');
      // 지운 관계 번호는 다시 주지 않는다
      const other = await create('P10 삭제 뒤 관계 대상');
      const again = (await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: src, sourceVersion: '0.1.0', targetFeatureId: other, targetVersion: '0.1.0' }).expect(201)).body;
      expect(Number(again.dependencyId.slice(4))).toBeGreaterThan(Number(dep.dependencyId.slice(4)));
    });
  });
});
