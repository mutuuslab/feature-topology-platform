// 분류 계층 L0~L5·Feature 배치·적용 지역 코드·브랜드별 정책(TX, B7 (b)) — FR-CAT-001·004, FR-REG-001-001·002·008·011, FR-CRC-001-002·003, FR-GLB-001-001~004
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeatureRepo } from '../../src/domains/d01-policy/repos';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp, nextRefId, withRef } from '../helpers';

const REFDB = actor('usr-refdb', 'REFDB_ADMIN');
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const OTHER = actor('usr-author2', 'FEATURE_AUTHOR');
const OPS = actor('usr-ops', 'OPERATOR');
const REG = actor('usr-reg', 'REGULATORY_OWNER');

describe('분류 계층·브랜드·지역 코드 (TX)', () => {
  let app: INestApplication;
  let http: () => any;
  let get: <T>(t: any) => T;
  beforeAll(async () => ({ app, http, get } = await bootApp()));
  afterAll(() => app.close());

  describe('분류 계층 L0~L5', () => {
    it('Feature DB 분류는 L0(도메인)·L1(클러스터·컴포넌트)로 보이고, 데모 시드가 L2~L5와 배치를 채운다', async () => {
      const r = await http().get('/api/taxonomy/levels').expect(200);
      const by = Object.fromEntries(r.body.items.map((x: any) => [x.level, x]));
      expect(by.L0.nodes).toBe(10);
      expect(by.L1.nodes).toBeGreaterThan(100);
      for (const l of ['L2', 'L3', 'L4', 'L5']) expect(by[l].nodes, l).toBeGreaterThan(0);
      for (const l of ['L0', 'L1', 'L2', 'L3', 'L4', 'L5']) expect(by[l].features, l).toBeGreaterThan(0);
      expect(r.body.placements).toBeGreaterThan(10);
    });

    it('수준별 분류 조회 — 노드마다 L0부터의 경로와 Feature', async () => {
      const r = await http().get('/api/taxonomy/levels/L4').expect(200);
      expect(r.body.items.length).toBeGreaterThan(0);
      expect(r.body.items[0].path.map((p: any) => p.level)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4']);
      expect(r.body.items[0].features[0]).toMatchObject({ featureId: expect.stringMatching(/^FEAT-/) });
      await http().get('/api/taxonomy/levels/L9').expect(400);
    });

    it('계층 트리와 수준 거른 목록', async () => {
      const t = await http().get('/api/taxonomy/nodes').expect(200);
      expect(t.body.tree).toHaveLength(10);
      const l2 = await http().get('/api/taxonomy/nodes?level=L2').expect(200);
      expect(l2.body.items.every((n: any) => n.level === 'L2')).toBe(true);
    });

    it('등록: 상위 없음·수준 건너뜀은 거부(감사 FAILED), 정확히 한 단계 아래만 등록', async () => {
      const l1 = (await http().get('/api/taxonomy/nodes?level=L1').expect(200)).body.items[0];
      const bad = await http().post('/api/taxonomy/nodes').set(REFDB).send({ nodeId: 'TX-T-L3', name: '건너뛴 노드', level: 'L3', parentId: l1.nodeId }).expect(400);
      expect(bad.body.error.details.code).toBe('TAXONOMY_LEVEL_MISMATCH');
      const nf = await http().post('/api/taxonomy/nodes').set(REFDB).send({ nodeId: 'TX-T-L2', name: '상위 없음', level: 'L2', parentId: 'NO-SUCH' }).expect(400);
      expect(nf.body.error.details.code).toBe('TAXONOMY_PARENT_NOT_FOUND');
      await http().post('/api/taxonomy/nodes').set(AUTHOR).send({ nodeId: 'TX-T-L2', name: '권한 없음', level: 'L2', parentId: l1.nodeId }).expect(403);
      const ok = await http().post('/api/taxonomy/nodes').set(REFDB).send({ nodeId: 'TX-T-L2', name: '시험 차량 기능', level: 'L2', parentId: l1.nodeId, reason: '시험' }).expect(201);
      expect(ok.body).toMatchObject({ level: 'L2', source: 'PLATFORM', createdBy: 'usr-refdb' });
      await http().post('/api/taxonomy/nodes').set(REFDB).send({ nodeId: 'TX-T-L3', name: '시험 SW 기능', level: 'L3', parentId: 'TX-T-L2' }).expect(201);
      const audit = await http().get('/api/audit?action=TAXONOMY_NODE_CREATE').expect(200);
      expect(audit.body.items.some((a: any) => a.result === 'FAILED')).toBe(true);
    });

    it('수정은 명칭·설명, Feature DB 분류는 고치지 않는다', async () => {
      const r = await http().patch('/api/taxonomy/nodes/TX-T-L3').set(REFDB).send({ name: '시험 SW 기능(고침)', reason: '이름 정리' }).expect(200);
      expect(r.body).toMatchObject({ name: '시험 SW 기능(고침)', updatedBy: 'usr-refdb' });
      await http().patch('/api/taxonomy/nodes/BC').set(REFDB).send({ name: '바꿈', reason: '시험' }).expect(409);
    });

    it('삭제: 하위가 있으면 거부, 하위부터 지우면 되고 지운 ID는 다시 쓰지 않는다', async () => {
      const c = await http().post('/api/taxonomy/nodes/TX-T-L2/delete').set(REFDB).send({ reason: '정리' }).expect(409);
      expect(c.body.error.details.code).toBe('TAXONOMY_HAS_CHILDREN');
      await http().post('/api/taxonomy/nodes/TX-T-L3/delete').set(REFDB).send({ reason: '정리' }).expect(201);
      await http().post('/api/taxonomy/nodes/TX-T-L2/delete').set(REFDB).send({ reason: '정리' }).expect(201);
      const reuse = await http().post('/api/taxonomy/nodes').set(REFDB).send({ nodeId: 'TX-T-L2', name: '다시', level: 'L0', parentId: null }).expect(409);
      expect(reuse.body.error.details.code).toBe('TAXONOMY_ID_USED');
      await http().post('/api/taxonomy/nodes/BC/delete').set(REFDB).send({ reason: '정리' }).expect(409);
    });

    it('배치된 Feature가 있는 노드는 지우지 않는다', async () => {
      const l2 = (await http().get('/api/taxonomy/nodes?level=L2').expect(200)).body.items.find((n: any) => n.featureCount > 0 && n.childCount === 0);
      const r = await http().post(`/api/taxonomy/nodes/${encodeURIComponent(l2.nodeId)}/delete`).set(REFDB).send({ reason: '정리' }).expect(409);
      expect(r.body.error.details.code).toBe('TAXONOMY_HAS_FEATURES');
    });
  });

  describe('Feature 분류 수준·배치·경로', () => {
    let featureId: string;
    beforeAll(async () => {
      const body = withRef({ name: '분류 시험 Feature', description: 'TX', requirementIds: ['REQ-TX-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'usr-author', asil: 'QM', upgVc: [], controlPoints: ['Flag'], taxonomyLevel: 'L2' }, nextRefId('QM'));
      featureId = (await http().post('/api/features').set(AUTHOR).send(body).expect(201)).body.featureId;
    });

    it('등록 때 분류 수준을 받고(없으면 L2), 목록은 분류 수준으로 거른다', async () => {
      const d = await http().get(`/api/features/${featureId}/taxonomy`).expect(200);
      expect(d.body).toMatchObject({ taxonomyLevel: 'L2', placement: null, path: [] });
      const l2 = await http().get('/api/features?latestOnly=true&taxonomyLevel=L2').expect(200);
      expect(l2.body.items.some((f: any) => f.featureId === featureId && f.taxonomyLevel === 'L2')).toBe(true);
      expect((await http().get('/api/features?taxonomyLevel=L5').expect(200)).body.items).toEqual([]);
      await http().post('/api/features').set(AUTHOR).send({ ...withRef({ name: '수준 틀림', description: 'TX', requirementIds: [], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Base', ownerId: 'usr-author', asil: 'QM', upgVc: [], controlPoints: [] }), taxonomyLevel: 'L7' }).expect(400);
    });

    it('같은 수준 노드에 배치하고 L0부터 경로·아래 구성을 본다(다른 수준은 거부)', async () => {
      const l3 = (await http().get('/api/taxonomy/nodes?level=L3').expect(200)).body.items[0];
      const wrong = await http().put(`/api/features/${featureId}/taxonomy`).set(AUTHOR).send({ nodeId: l3.nodeId }).expect(400);
      expect(wrong.body.error.details.code).toBe('TAXONOMY_PLACEMENT_LEVEL');
      await http().put(`/api/features/${featureId}/taxonomy`).set(OPS).send({ nodeId: l3.parentId }).expect(403);
      const p = await http().put(`/api/features/${featureId}/taxonomy`).set(AUTHOR).send({ nodeId: l3.parentId, reason: '분류' }).expect(200);
      expect(p.body).toMatchObject({ featureId, nodeId: l3.parentId, placedBy: 'usr-author' });
      const v = await http().get(`/api/features/${featureId}/taxonomy`).expect(200);
      expect(v.body.path.map((n: any) => n.level)).toEqual(['L0', 'L1', 'L2']);
      expect(v.body.below.map((n: any) => n.level)).toEqual(['L3', 'L4', 'L5']);
    });
  });

  describe('적용 지역 코드·Variant Rule 후보', () => {
    it('대응 표 14개 — 코드마다 시장·국가·Feature 수', async () => {
      const r = await http().get('/api/region-codes').expect(200);
      expect(r.body.items.map((x: any) => x.code).join('')).toBe('123456789ABCDG');
      expect(r.body.items.find((x: any) => x.code === '1')).toMatchObject({ nameKo: '한국', market: 'KR' });
      expect(r.body.items.find((x: any) => x.code === '1').features).toBeGreaterThan(0);
    });

    it('룰 등록 — 지역 코드 체계 밖이면 사유와 함께 400, 시장과 맞으면 등록', async () => {
      const base = { ruleId: 'CR-TX-001', name: '유럽 지역 코드 룰', type: 'PRIVACY', criteria: [{ check: 'SAFE_DEFAULT_OFF' }], approverIds: ['usr-safety'], evidence: { docName: 'GDPR' }, validFrom: '2026-01-01' };
      const bad = await http().post('/api/compliance-rules').set(REG).send({ ...base, scope: { markets: ['EU'], regionCodes: ['E'] } }).expect(400);
      expect(JSON.stringify(bad.body)).toMatch(/1~9·A~D·G/);
      await http().post('/api/compliance-rules').set(REG).send({ ...base, scope: { markets: ['KR'], regionCodes: ['4'] } }).expect(400);
      const ok = await http().post('/api/compliance-rules').set(REG).send({ ...base, scope: { markets: ['EU'], regionCodes: ['4'] } }).expect(201);
      expect(ok.body.scope.regionCodes).toEqual(['4']);
    });

    it('지역 코드 기준 후보 — 기존 Variant 조건과 26580 구성 규칙', async () => {
      const r = await http().get('/api/region-codes/variant-candidates?codes=1').expect(200);
      expect(r.body.countries).toEqual(['KR']);
      expect(r.body.variantConditions.length).toBeGreaterThan(0);
      expect(r.body.variantConditions.every((v: any) => v.country === 'KR' && v.source === 'VARIANT_CONDITION')).toBe(true);
      expect(r.body.compositions.every((p: any) => p.country === 'KR' && p.source === 'COMPOSITION_RULE')).toBe(true);
      await http().get('/api/region-codes/variant-candidates?codes=Z').expect(400);
      await http().get('/api/region-codes/variant-candidates').expect(400);
    });
  });

  describe('브랜드·권역별 정책', () => {
    let policyId: string;
    beforeAll(async () => {
      // 시드 Feature Owner는 팀 이름이라 계정과 겹치지 않는다 — 시험은 배포 정책 하나의 Feature Owner를 시험 계정으로 바꿔 둔다
      // 시드가 붙인 조건은 지워 등록부터 본다
      const p = (await http().get('/api/policies').expect(200)).body.items.find((x: any) => x.status !== 'RETIRED');
      policyId = p.policyId;
      const db = get<Db>(DB);
      db.run('DELETE FROM policy_global_scope WHERE policy_id = ?', policyId);
      db.run('DELETE FROM policy_global_link WHERE policy_id = ?', policyId);
      const repo = get<FeatureRepo>(FeatureRepo);
      const f = repo.versions(p.featureId).at(-1)!;
      repo.update({ ...f, ownerId: 'usr-author' });
    });

    it('브랜드 목록 3종, 목록 밖 브랜드 조회·등록은 400', async () => {
      const b = await http().get('/api/brands').expect(200);
      expect(b.body.items.map((x: any) => x.brand)).toEqual(['HYUNDAI', 'KIA', 'GENESIS']);
      await http().get('/api/brands/TESLA/policies').expect(400);
      const r = await http().post(`/api/policies/${policyId}/global-scope`).set(AUTHOR).send({ brands: ['TESLA'], reason: '등록' }).expect(400);
      expect(JSON.stringify(r.body)).toMatch(/등록할 수 없는 브랜드/);
    });

    it('등록 → 브랜드별·조건별 조회, 없는 조건은 빈 목록', async () => {
      await http().post(`/api/policies/${policyId}/global-scope`).set(AUTHOR).send({ brands: ['GENESIS'], regionCodes: ['4'], complianceRuleIds: ['NO-RULE-1'], reason: '등록' }).expect(400);
      const s = await http().post(`/api/policies/${policyId}/global-scope`).set(AUTHOR).send({ brands: ['GENESIS'], regionCodes: ['4'], reason: '유럽 제네시스' }).expect(201);
      expect(s.body).toMatchObject({ policyId, brands: ['GENESIS'], regionCodes: ['4'], revision: 1 });
      await http().post(`/api/policies/${policyId}/global-scope`).set(AUTHOR).send({ brands: ['KIA'], reason: '두 번' }).expect(409);
      const g = await http().get('/api/brands/GENESIS/policies').expect(200);
      expect(g.body.items.map((x: any) => x.policyId)).toContain(policyId);
      const q = await http().get(`/api/global-scopes?regionCode=4&brand=GENESIS`).expect(200);
      expect(q.body.items.map((x: any) => x.policyId)).toContain(policyId);
      expect((await http().get(`/api/global-scopes?featureId=FEAT-99999`).expect(200)).body.items).toEqual([]);
    });

    it('수정은 Feature Owner만(다른 작성자는 403·수정 불가 메시지, 감사 DENIED)', async () => {
      const no = await http().put(`/api/policies/${policyId}/global-scope`).set(OTHER).send({ brands: ['KIA'], reason: '바꿈' }).expect(403);
      expect(no.body.error.message).toMatch(/Owner.*시스템 관리자/);
      const ok = await http().put(`/api/policies/${policyId}/global-scope`).set(AUTHOR).send({ brands: ['HYUNDAI', 'KIA'], regionCodes: ['4'], reason: '브랜드 확대' }).expect(200);
      expect(ok.body).toMatchObject({ brands: ['HYUNDAI', 'KIA'], revision: 2 });
      expect((await http().get('/api/brands/GENESIS/policies').expect(200)).body.items.map((x: any) => x.policyId)).not.toContain(policyId);
      const audit = await http().get('/api/audit?action=POLICY_GLOBAL_SCOPE_UPDATE').expect(200);
      expect(audit.body.items.map((a: any) => a.result).sort()).toEqual(['ALLOWED', 'DENIED']);
    });
  });
});
