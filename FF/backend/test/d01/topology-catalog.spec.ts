// Feature Topology (D01-02) · Feature Catalog (D01-03) — 상세설계서 표 8·9·17·21·22 흐름을 API로 검증한다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp, confirmSafety } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const P_AUTHOR = actor('yoon.product', 'PRODUCT_AUTHOR');
const P_APPROVER_A = actor('seo.cfg', 'PRODUCT_APPROVER');
const P_APPROVER_B = actor('kang.rel', 'PRODUCT_APPROVER');

describe('Topology · Catalog', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp()));
  afterAll(() => app.close());

  const judgeAll = async (id: string, ver: string, gates: string[]) => {
    if (gates.some((g) => g !== 'G1')) await confirmSafety(http, id, ver);
    for (const gate of gates)
      await http().post(`/api/features/${id}/versions/${ver}/gates`).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: `${gate} 확인`, evidenceRef: `EV-${gate}` }).expect(201);
  };
  const newFeature = async (name: string) =>
    (
      await http()
        .post('/api/features')
        .set(AUTHOR)
        .send({ name, description: `${name} 설명`, requirementIds: ['REQ-T-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'] })
        .expect(201)
    ).body;

  describe('사전점검 (DATA-PRECHECK)', () => {
    it('16 규칙의 판정이 데이터셋 예시 판정과 같고, 데이터 품질 경고 22건을 함께 낸다', async () => {
      const r = await http().get('/api/precheck').expect(200);
      expect(r.body.rules).toHaveLength(16);
      for (const rule of r.body.rules) expect(rule.result, rule.ruleId).toBe(rule.expected);
      expect(r.body.summary).toEqual({ PASS: 12, CONDITIONAL: 4, FAIL: 0, dataQualityFindings: 22 });
    });
  });

  describe('관계 그래프·변경 영향', () => {
    it('FEAT-00022 주변 그래프에 REQUIRES DEP-00013 → FEAT-00145@5.4.2', async () => {
      const r = await http().get('/api/topology/graph?featureId=FEAT-00022').expect(200);
      expect(r.body.edges).toContainEqual(expect.objectContaining({ id: 'DEP-00013', source: 'FEAT-00022@1.0.0', target: 'FEAT-00145@5.4.2', type: 'REQUIRES', verdict: 'PASS' }));
      expect(r.body.nodes.find((n: any) => n.id === 'FEAT-00145@5.4.2')).toMatchObject({ name: '스마트 크루즈 컨트롤', lifecycle: 'RELEASED' });
    });

    it('FEAT-00145(스마트 크루즈) 변경 영향: 의존자 FEAT-00022, 상품 CAT-00013·CAT-00019, SW 변경은 G5 재판정', async () => {
      const r = await http().get('/api/impact/FEAT-00145/5.4.2?changed=swVersions').expect(200);
      expect(r.body.dependents.map((d: any) => d.featureId)).toContain('FEAT-00022');
      const cats = r.body.products.map((p: any) => p.catalogId);
      expect(cats).toEqual(expect.arrayContaining(['CAT-00013', 'CAT-00019']));
      const c19 = r.body.products.find((p: any) => p.catalogId === 'CAT-00019');
      expect(c19.via).toEqual(expect.arrayContaining([expect.objectContaining({ baselineId: 'BL-00163', direct: true }), expect.objectContaining({ baselineId: 'BL-00028', direct: false })]));
      expect(r.body.rejudge).toEqual(['G5']);
      expect(r.body.owners.length).toBeGreaterThan(1);
    });
  });

  describe('의존관계 등록·판정', () => {
    let x: any;

    it('RELEASED 원천에는 관계를 추가할 수 없다 (새 Version으로)', async () => {
      const r = await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: 'FEAT-00022', sourceVersion: '1.0.0', targetFeatureId: 'FEAT-00024', targetVersion: '1.0.0' }).expect(409);
      expect(r.body.error.code).toBe('IMMUTABLE');
    });

    it('PROPOSED 원천 → 미판정으로 등록되고 Feature 의존관계 목록에 반영', async () => {
      x = await newFeature('고속 합류 보조');
      const r = await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: x.featureId, sourceVersion: '0.1.0', targetFeatureId: 'FEAT-00145', targetVersion: '5.4.2' }).expect(201);
      expect(r.body).toMatchObject({ verdict: '미판정', targetVersionCheck: expect.any(String), ruleVersion: 'DATA-PRECHECK-1.0' });
      const d = await http().get(`/api/features/${x.featureId}/versions/0.1.0`).expect(200);
      expect(d.body.feature.dependencyIds).toEqual([r.body.dependencyId]);
      x.dep = r.body.dependencyId;
    });

    it('같은 관계 재등록·다른 범위·순환은 422', async () => {
      await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: x.featureId, sourceVersion: '0.1.0', targetFeatureId: 'FEAT-00145', targetVersion: '5.4.2' }).expect(422);
      const eu = await http().get('/api/features?country=EU&lifecycle=RELEASED').expect(200);
      const t = eu.body.items[0];
      const scope = await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: x.featureId, sourceVersion: '0.1.0', targetFeatureId: t.featureId, targetVersion: t.version }).expect(422);
      expect(scope.body.error.details.issues.map((i: any) => i.code)).toContain('SCOPE_MISMATCH');
      const y = await newFeature('고속 합류 경고음');
      await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: y.featureId, sourceVersion: '0.1.0', targetFeatureId: x.featureId, targetVersion: '0.1.0' }).expect(201);
      const cyc = await http().post('/api/dependencies').set(AUTHOR).send({ type: 'REQUIRES', sourceFeatureId: x.featureId, sourceVersion: '0.1.0', targetFeatureId: y.featureId, targetVersion: '0.1.0' }).expect(422);
      expect(cyc.body.error.details.issues.map((i: any) => i.code)).toContain('REQUIRES_CYCLE');
    });

    it('원천이 승인되면 관계를 다시 판정해 미판정 → PASS', async () => {
      await judgeAll(x.featureId, '0.1.0', ['G1', 'G2', 'G3']);
      await http().post(`/api/features/${x.featureId}/versions/0.1.0/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '정의 승인' }).expect(200);
      const deps = await http().get(`/api/dependencies?featureId=${x.featureId}`).expect(200);
      expect(deps.body.items.find((d: any) => d.dependencyId === x.dep).verdict).toBe('PASS');
      const ev = await http().get('/api/events?type=dependency.rejudged').expect(200);
      expect(ev.body.items.at(-1)).toMatchObject({ aggregate: x.dep, payload: { from: '미판정', to: 'PASS' } });
    });
  });

  describe('상품 (Catalog)', () => {
    it('목록 18건, CAT-00019 상세: 구성 PASS·출시 적격·가능한 전이 VERIFIED', async () => {
      const l = await http().get('/api/products').expect(200);
      expect(l.body.items).toHaveLength(18);
      const r = await http().get('/api/products/CAT-00019/versions/1.0.0').expect(200);
      expect(r.body.composition.result).toBe('PASS');
      expect(r.body.eligibility).toEqual({ eligible: true, reasons: [] });
      expect(r.body.transitions.map((t: any) => [t.to, t.blockers.length])).toEqual([['VERIFIED', 0]]);
    });

    it('BOM 후보: 같은 범위의 확정 Baseline만, REQUIRES 대상 표시', async () => {
      const r = await http().get('/api/products/candidates?country=KR&vehicleModel=NX4 PE&trim=Premium').expect(200);
      const c = r.body.items.find((i: any) => i.baselineId === 'BL-00028');
      expect(c).toMatchObject({ featureId: 'FEAT-00022', requires: ['FEAT-00145@5.4.2'] });
      expect(r.body.items.every((i: any) => i.country === 'KR' && i.vehicleModel === 'NX4 PE')).toBe(true);
    });

    it('저장 없는 구성 검증: REQUIRES 대상을 빼면 FAIL과 사유', async () => {
      const r = await http().post('/api/products/validate').set(P_AUTHOR).send({ country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', type: 'PACKAGE', baselineIds: ['BL-00028', 'BL-00029'] }).expect(200);
      expect(r.body.result).toBe('FAIL');
      expect(r.body.issues.map((i: any) => i.code)).toContain('REQUIRES_MISSING');
    });

    describe('신규 상품: 구성 승인 → 검증 → 고객 출시 승인 (두 승인 분리)', () => {
      let cat: string;
      it('상품 작성자가 등록 → PROPOSED 1.0.0, 구성 PASS', async () => {
        const r = await http()
          .post('/api/products')
          .set(P_AUTHOR)
          .send({ name: 'Safe Distance 1회 체험', description: '전방 안전거리 3단계 1회 체험', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', saleType: '체험', type: 'PACKAGE', baselineIds: ['BL-00028', 'BL-00163'], validFrom: '2026-11-01', validTo: '2026-11-30', ownerId: '선행상품기획팀' })
          .expect(201);
        cat = r.body.product.catalogId;
        expect(cat).toMatch(/^CAT-\d{5}$/);
        expect(r.body.composition.result).toBe('PASS');
      });

      it('작성자 본인 승인은 불가(역할), 승인자는 구성 승인 → 모든 Feature RELEASED라 APPROVED 유지', async () => {
        await http().post(`/api/products/${cat}/versions/1.0.0/transitions`).set(P_AUTHOR).send({ to: 'APPROVED', reason: '셀프' }).expect(403);
        const r = await http().post(`/api/products/${cat}/versions/1.0.0/transitions`).set(P_APPROVER_A).send({ to: 'APPROVED', reason: '구성 확인' }).expect(200);
        expect(r.body.product.lifecycle).toBe('APPROVED');
        await http().post(`/api/products/${cat}/versions/1.0.0/transitions`).set(P_APPROVER_A).send({ to: 'VERIFIED', reason: '상품 검증 완료' }).expect(200);
      });

      it('구성 승인자는 고객 출시 승인을 할 수 없다 → 다른 승인자가 출시', async () => {
        const r = await http().post(`/api/products/${cat}/versions/1.0.0/transitions`).set(P_APPROVER_A).send({ to: 'RELEASED', reason: '출시' }).expect(403);
        expect(r.body.error.code).toBe('SEPARATION_OF_DUTY');
        const ok = await http().post(`/api/products/${cat}/versions/1.0.0/transitions`).set(P_APPROVER_B).send({ to: 'RELEASED', reason: '고객 출시 승인' }).expect(200);
        expect(ok.body.product.lifecycle).toBe('RELEASED');
      });

      it('RELEASED 구성은 직접 수정 불가 → 새 Version에서 REQUIRES 대상을 빼면 구성 승인이 막힌다', async () => {
        await http().patch(`/api/products/${cat}/versions/1.0.0`).set(P_AUTHOR).send({ name: 'x' }).expect(409);
        const v = await http().post(`/api/products/${cat}/versions`).set(P_AUTHOR).send({ baseVersion: '1.0.0', reason: '구성 축소', changes: { baselineIds: ['BL-00028'], type: 'SINGLE' } }).expect(201);
        expect(v.body.product).toMatchObject({ version: '1.1.0', lifecycle: 'PROPOSED' });
        expect(v.body.composition.result).toBe('FAIL');
        const r = await http().post(`/api/products/${cat}/versions/1.1.0/transitions`).set(P_APPROVER_A).send({ to: 'APPROVED', reason: '구성 확인' }).expect(422);
        expect(r.body.error.details.composition.issues.map((i: any) => i.code)).toContain('REQUIRES_MISSING');
      });
    });

    it('RELEASED가 아닌 Feature가 포함되면 구성 승인 후 시스템이 DEVELOPING(출시 대기)로 옮긴다', async () => {
      const cat1 = (await http().get('/api/products/CAT-00001/versions/3.0.0').expect(200)).body.product;
      const r = await http()
        .post('/api/products')
        .set(P_AUTHOR)
        .send({ name: 'Parking Assist Trial', description: '주차 보조 체험', country: cat1.country, vehicleModel: cat1.vehicleModel, trim: cat1.trim, saleType: '체험', type: 'PACKAGE', baselineIds: cat1.baselineIds, validFrom: null, validTo: null, ownerId: '주차상품기획팀' })
        .expect(201);
      const t = await http().post(`/api/products/${r.body.product.catalogId}/versions/1.0.0/transitions`).set(P_APPROVER_A).send({ to: 'APPROVED', reason: '구성 확인' }).expect(200);
      expect(t.body.product.lifecycle).toBe('DEVELOPING');
      const d = await http().get(`/api/products/${r.body.product.catalogId}/versions/1.0.0`).expect(200);
      expect(d.body.eligibility.eligible).toBe(false);
      expect(d.body.eligibility.reasons.join(' ')).toContain('RELEASED가 아닌 Feature');
    });
  });
});
