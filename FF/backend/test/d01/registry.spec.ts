// Feature Registry·Gate·Lifecycle·BOM Baseline — 상세설계서 v0.81 업무 흐름(표 4)을 API로 끝까지 검증한다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp, confirmSafety } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const AUTHOR2 = actor('park.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const BOM = actor('jung.bom', 'BOM_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');

describe('Feature Registry (D01-01) · Gate (D01-02) · BOM Baseline', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp()));
  afterAll(() => app.close());

  const judge = (id: string, ver: string, gate: string, inputResult = 'PASS', who = JUDGE) =>
    http()
      .post(`/api/features/${id}/versions/${ver}/gates`)
      .set(who)
      .send({ gate, inputResult, rationale: `${gate} 검토 완료`, evidenceRef: inputResult === 'PASS' ? `EV-TEST-${gate}` : null });

  describe('조회', () => {
    it('목록: 80개 버전, 최신만 68개, 상태별 집계', async () => {
      const all = await http().get('/api/features').expect(200);
      expect(all.body.total).toBe(80);
      expect(all.body.facets.lifecycle).toMatchObject({ RELEASED: 30, PROPOSED: 13 });
      const latest = await http().get('/api/features?latestOnly=true').expect(200);
      expect(latest.body.total).toBe(68);
      const q = await http().get('/api/features?q=전방 안전거리').expect(200);
      expect(q.body.items.map((i: any) => i.featureId)).toContain('FEAT-00022');
    });

    it('FEAT-00022 상세: 19 속성·Gate 9건·의존관계·구현 추적·Baseline·사용 상품·가능한 전이', async () => {
      const r = await http().get('/api/features/FEAT-00022/versions/1.0.0').expect(200);
      expect(r.body.feature).toMatchObject({ lifecycle: 'RELEASED', baselineId: 'BL-00028' });
      expect(Object.keys(r.body.gates)).toHaveLength(9);
      expect(r.body.dependencies.outgoing.map((d: any) => d.dependencyId)).toEqual(['DEP-00013']);
      expect(r.body.trace.map((t: any) => [t.swId, t.sw?.name, t.ecu?.name])).toEqual([
        ['SW-CARE-SDIST-APP', 'Extended Gap Control App', 'ADAS Domain Controller'],
        ['SW-CARE-SCC-ADP', 'SCC Policy Adapter', 'ADAS Domain Controller'],
      ]);
      expect(r.body.baseline.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(r.body.products.map((p: any) => p.catalogId)).toEqual(['CAT-00013', 'CAT-00019']);
      expect(r.body.transitions.map((t: any) => t.to)).toEqual(['DEPRECATED']);
    });

    it('Baseline 해시는 Lifecycle을 제외한 내용으로 계산되고 검증된다 (골든)', async () => {
      const r = await http().get('/api/baselines/BL-00028').expect(200);
      expect(r.body.verified).toBe(true);
      expect(r.body.baseline.contentHash).toBe(GOLDEN_BL_00028);
    });
  });

  describe('신규 Feature: 등록 → G1~G3 → 정의 승인 → 자동 DEVELOPING', () => {
    let id: string;

    it('작성자가 등록하면 PROPOSED 0.1.0, 다음 ID 발급, 감사·이벤트', async () => {
      const r = await http()
        .post('/api/features')
        .set(AUTHOR)
        .send({ name: '야간 보행자 경고', description: '야간 보행자 접근 시 HUD 경고', requirementIds: ['REQ-CARE-9001'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'B', upgVc: ['F111A114001'], controlPoints: ['Flag'] })
        .expect(201);
      id = r.body.featureId;
      expect(id).toMatch(/^FEAT-\d{5}$/);
      expect(r.body).toMatchObject({ version: '0.1.0', lifecycle: 'PROPOSED', baselineId: null });
      const ev = await http().get(`/api/events?aggregate=${id}@0.1.0`).expect(200);
      expect(ev.body.items[0].type).toBe('feature.created');
    });

    it('같은 범위의 유사 명칭은 409와 후보 목록', async () => {
      const r = await http()
        .post('/api/features')
        .set(AUTHOR)
        .send({ name: '전방 안전거리 3단계', description: 'x', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'x', asil: 'B' })
        .expect(409);
      expect(r.body.error.details.similar.map((s: any) => s.featureId)).toContain('FEAT-00022');
    });

    it('증거 없는 PASS는 400', async () => {
      const r = await http().post(`/api/features/${id}/versions/0.1.0/gates`).set(JUDGE).send({ gate: 'G1', inputResult: 'PASS', rationale: '확인' }).expect(400);
      expect(r.body.error.details[0].path).toBe('evidenceRef');
    });

    it('앞 단계 Gate가 PASS가 아니면 다음 단계 Gate를 판정할 수 없다', async () => {
      const r = await judge(id, '0.1.0', 'G4').expect(422);
      expect(r.body.error.message).toContain('DEVELOPING');
    });

    it('G1~G3 PASS 전에는 정의 승인이 막히고 막힌 사유를 모두 돌려준다', async () => {
      await judge(id, '0.1.0', 'G1').expect(201);
      await confirmSafety(http, id, '0.1.0');
      const r = await http().post(`/api/features/${id}/versions/0.1.0/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '정의 검토 완료' }).expect(422);
      expect(r.body.error.details.blockers.map((b: any) => b.ref)).toEqual(['G2', 'G3']);
    });

    it('CONDITIONAL은 검토 중, 재판정은 새 레코드로 남는다', async () => {
      await judge(id, '0.1.0', 'G2', 'CONDITIONAL').expect(201);
      await judge(id, '0.1.0', 'G2').expect(201);
      const g = await http().get(`/api/features/${id}/versions/0.1.0/gates`).expect(200);
      const g2 = g.body.gates.find((x: any) => x.gate === 'G2');
      expect(g2.history.map((h: any) => h.status)).toEqual(['검토 중', 'PASS']);
      expect(g2.history[0].gateRecordId).not.toBe(g2.history[1].gateRecordId);
      expect(g2.status).toBe('PASS');
    });

    it('작성자 본인은 승인할 수 없다 (역할 거부는 DENIED 감사)', async () => {
      await judge(id, '0.1.0', 'G3').expect(201);
      await http().post(`/api/features/${id}/versions/0.1.0/transitions`).set(AUTHOR).send({ to: 'APPROVED', reason: '셀프' }).expect(403);
      const a = await http().get(`/api/audit?actorId=kim.author&result=DENIED`).expect(200);
      expect(a.body.items.length).toBeGreaterThan(0);
    });

    it('Feature 승인자가 승인하면 APPROVED → (CP 1개 이상) 자동 DEVELOPING, 전이마다 감사', async () => {
      const r = await http().post(`/api/features/${id}/versions/0.1.0/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '정의·요구·사양 확인' }).expect(200);
      expect(r.body.lifecycle).toBe('DEVELOPING');
      const a = await http().get(`/api/audit?target=${id}@0.1.0`).expect(200);
      const actions = a.body.items.map((x: any) => `${x.actorId}:${x.action}`);
      expect(actions).toContain('lee.approver:FEATURE_TRANSITION PROPOSED→APPROVED');
      expect(actions).toContain('system:registry:FEATURE_TRANSITION APPROVED→DEVELOPING');
    });

    it('APPROVED 이후 수정은 409 IMMUTABLE (새 Version 안내)', async () => {
      const r = await http().patch(`/api/features/${id}/versions/0.1.0`).set(AUTHOR).send({ description: '변경' }).expect(409);
      expect(r.body.error.code).toBe('IMMUTABLE');
    });

    it('G4~G7 PASS여도 Control Point 정책·구현 입력이 없으면 VERIFIED로 자동 전이하지 않는다', async () => {
      for (const g of ['G4', 'G5', 'G6', 'G7']) await judge(id, '0.1.0', g).expect(201);
      const d = await http().get(`/api/features/${id}/versions/0.1.0`).expect(200);
      expect(d.body.feature.lifecycle).toBe('DEVELOPING');
      const codes = d.body.transitions.find((t: any) => t.to === 'VERIFIED').blockers.map((b: any) => b.code);
      expect(codes).toEqual(expect.arrayContaining(['INPUT_MISSING', 'POLICY_MISSING']));
    });

    it('Baseline 요청은 받지만, 체크리스트(구현 속성 누락) 때문에 확정되지 않는다', async () => {
      const req = await http().post('/api/baselines/requests').set(AUTHOR).send({ featureId: id, version: '0.1.0', reason: '개발 착수 기준선' }).expect(201);
      const r = await http().post(`/api/baselines/requests/${req.body.requestId}/decision`).set(BOM).send({ decision: 'APPROVE', reason: '확정' }).expect(422);
      const failed = r.body.error.details.checklist.filter((c: any) => c.state === 'FAIL').map((c: any) => c.id);
      expect(failed).toEqual(['ATTRS', 'IMPLEMENTATION']);
      await http().post(`/api/baselines/requests/${req.body.requestId}/decision`).set(BOM).send({ decision: 'REJECT', reason: 'Function·SW·ECU 입력 후 재요청' }).expect(200);
    });
  });

  describe('기존 Feature 변경: 새 Version → 재승인 → 별도 BOM 확정 (이전 Baseline 유지)', () => {
    let ver: string;
    let requestId: string;

    it('국가·차종·트림 변경은 새 Feature ID가 필요하다 (400)', async () => {
      await http().post('/api/features/FEAT-00022/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason: 'EU 확장', changes: { country: 'EU' } }).expect(400);
    });

    it('설명 변경 → 1.1.0 PROPOSED, 재판정 대상 G1, BOM 승인자 알림 이벤트', async () => {
      const r = await http()
        .post('/api/features/FEAT-00022/versions')
        .set(AUTHOR)
        .send({ baseVersion: '1.0.0', bump: 'minor', reason: '위험 단계 안내 문구 명확화', changes: { description: '전방 차량과의 거리를 정상·주의·위험 3단계로 판정하고, 위험 단계에서 감속을 요청' } })
        .expect(201);
      ver = r.body.feature.version;
      expect(ver).toBe('1.1.0');
      expect(r.body).toMatchObject({ changed: ['description'], rejudge: ['G1'] });
      expect(r.body.feature).toMatchObject({ lifecycle: 'PROPOSED', baselineId: null });
      const ev = await http().get('/api/events?type=feature.version.created').expect(200);
      expect(ev.body.items.at(-1).payload.notifyBomApprover).toBe(true);
      // 이전 Version·Baseline은 그대로
      const old = await http().get('/api/features/FEAT-00022/versions/1.0.0').expect(200);
      expect(old.body.feature).toMatchObject({ lifecycle: 'RELEASED', baselineId: 'BL-00028' });
    });

    it('PROPOSED 버전은 Baseline 요청 대상이 아니다', async () => {
      await http().post('/api/baselines/requests').set(AUTHOR).send({ featureId: 'FEAT-00022', version: ver, reason: '요청' }).expect(422);
    });

    it('G1~G3 → 승인 → 자동 DEVELOPING → Baseline 요청', async () => {
      await confirmSafety(http, 'FEAT-00022', ver); // 새 Version은 앞 Version 분류를 이어받되 다시 확정(FFG-CLS-004)
      for (const g of ['G1', 'G2', 'G3']) await judge('FEAT-00022', ver, g).expect(201);
      const t = await http().post(`/api/features/FEAT-00022/versions/${ver}/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '문구 변경 승인' }).expect(200);
      expect(t.body.lifecycle).toBe('DEVELOPING');
      const q = await http().post('/api/baselines/requests').set(AUTHOR2).send({ featureId: 'FEAT-00022', version: ver, reason: '변경 Version 기준선' }).expect(201);
      requestId = q.body.requestId;
      expect(requestId).toMatch(/^BR-\d{5}$/);
      await http().post('/api/baselines/requests').set(AUTHOR2).send({ featureId: 'FEAT-00022', version: ver, reason: '중복' }).expect(409);
    });

    it('체크리스트: 8항목, 이전 BL-00028 대비 diff와 영향 상품', async () => {
      const r = await http().get(`/api/baselines/requests/${requestId}`).expect(200);
      const byId = Object.fromEntries(r.body.checklist.map((c: any) => [c.id, c]));
      expect(Object.keys(byId)).toEqual(['STATE', 'ATTRS', 'SCOPE', 'DEPENDENCY', 'IMPLEMENTATION', 'GATES', 'DIFF', 'PRODUCTS']);
      expect(r.body.checklist.filter((c: any) => c.state === 'FAIL')).toEqual([]);
      expect(byId.DIFF.data.map((d: any) => d.field)).toEqual(['description', 'version']);
      expect(byId.PRODUCTS.data).toEqual(['CAT-00013@1.1.0', 'CAT-00019@1.0.0']);
    });

    it('요청자 본인은 승인할 수 없다 (직무 분리, FAILED 감사)', async () => {
      const self = actor('park.author', 'BOM_APPROVER');
      const r = await http().post(`/api/baselines/requests/${requestId}/decision`).set(self).send({ decision: 'APPROVE', reason: '확정' }).expect(403);
      expect(r.body.error.code).toBe('SEPARATION_OF_DUTY');
    });

    it('BOM 승인자가 확정하면 새 BL 발급·해시·Registry 갱신·이벤트, 재요청은 409', async () => {
      const r = await http().post(`/api/baselines/requests/${requestId}/decision`).set(BOM).send({ decision: 'APPROVE', reason: '체크리스트 충족' }).expect(200);
      const bl = r.body.baseline;
      expect(bl.baselineId).toMatch(/^BL-\d{5}$/);
      expect(bl.baselineId).not.toBe('BL-00028');
      expect(bl.contentHash).not.toBe(GOLDEN_BL_00028);
      const f = await http().get(`/api/features/FEAT-00022/versions/${ver}`).expect(200);
      expect(f.body.feature.baselineId).toBe(bl.baselineId);
      const got = await http().get(`/api/baselines/${bl.baselineId}`).expect(200);
      expect(got.body).toMatchObject({ verified: true, previous: { baselineId: 'BL-00028' } });
      const ev = await http().get('/api/events?type=baseline.confirmed').expect(200);
      expect(ev.body.items.at(-1).payload.baselineId).toBe(bl.baselineId);
      await http().post('/api/baselines/requests').set(AUTHOR).send({ featureId: 'FEAT-00022', version: ver, reason: '재발급' }).expect(409);
    });
  });

  describe('RELEASED 이후', () => {
    it('RELEASED 버전은 수정·Gate 판정 불가 (409 IMMUTABLE)', async () => {
      await http().patch('/api/features/FEAT-00022/versions/1.0.0').set(AUTHOR).send({ description: 'x' }).expect(409);
      const r = await judge('FEAT-00022', '1.0.0', 'G9').expect(409);
      expect(r.body.error.code).toBe('IMMUTABLE');
    });

    it('DEPRECATED 전이 — Baseline은 Lifecycle만 따라가고 해시는 그대로', async () => {
      await http().post('/api/features/FEAT-00022/versions/1.0.0/transitions').set(RELEASE).send({ to: 'DEPRECATED', reason: '1.1.0으로 대체' }).expect(200);
      const r = await http().get('/api/baselines/BL-00028').expect(200);
      expect(r.body.baseline.snapshot.lifecycle).toBe('DEPRECATED');
      expect(r.body.baseline.contentHash).toBe(GOLDEN_BL_00028);
      expect(r.body.verified).toBe(true);
    });
  });
});

/** BL-00028 (FEAT-00022 1.0.0) 내용 해시 — 데이터셋·정규화 규칙이 바뀌면 의도적으로 갱신한다. */
const GOLDEN_BL_00028 = 'sha256:d6c7d3ac6de089d4abc85cb73f03fab1458181bba57c6571fab025433ffa65e1';
