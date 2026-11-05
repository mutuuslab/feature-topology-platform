// 담당자 웨이브 W4(2026-11-05) — 등록·구현 연결·상품·정책: 상품기획·SW 통합 담당자가 막다른 길 없이 끝까지 가는지.
//   P2-2/P3-8 구현 연결은 기준정보 짝만, 새 기능은 이름만 · 정의 승인 뒤 구현 미입력은 새 Version으로 · 막힌 사유는 한글 칸 이름
//   P2-6 검증 전 정책 승인 거부는 사실 한 문장 · P1-10 구성 실패 문구에 더할 Baseline · P1-2 역할 이름(코드 아님) · P1-3 시뮬레이터 차량은 체험 제외
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp, confirmSafety, withRef } from '../helpers';

const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const IMPLEMENTER = actor('usr-integrator', 'IMPLEMENTER');
const APPROVER = actor('usr-approver', 'FEATURE_APPROVER');
const JUDGE = actor('usr-quality', 'GATE_JUDGE');
const P_AUTHOR = actor('usr-commerce', 'PRODUCT_AUTHOR');
const P_APPROVER = actor('usr-approver', 'PRODUCT_APPROVER');
const PRODUCT_OWNER = actor('usr-productowner', 'PRODUCT_APPROVER');
const GOOD = { swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] };

describe('담당자 웨이브 W4 — 등록·구현 연결·상품·정책', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' })));
  afterAll(() => app.close());

  const register = async (name: string) =>
    (await http().post('/api/features').set(AUTHOR).send(withRef({ name, description: 'W4 시험', requirementIds: ['REQ-W4-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'ADAS상품기획팀', asil: 'QM', upgVc: ['F111A114001'], controlPoints: ['Flag'] })).expect(201)).body.featureId as string;
  const approve = async (fid: string, ver = '0.1.0') => {
    await confirmSafety(http, fid, ver);
    for (const g of ['G1', 'G2', 'G3']) await http().post(`/api/features/${fid}/versions/${ver}/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
    return http().post(`/api/features/${fid}/versions/${ver}/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '정의 확인' }).expect(200);
  };

  let linked: string;
  it('구현 연결: 기준정보에 없는 SW·제어기 짝은 400과 사유, 새 기능은 이름만 보내면 FUNC 번호를 받고, SW 통합 담당도 저장한다', async () => {
    linked = await register('W4 구현 연결 Feature');
    const base = `/api/features/${linked}/versions/0.1.0`;
    const bad = await http().patch(base).set(AUTHOR).send({ swIds: ['SW-CARE-SDIST-APP'], swVersions: ['9.9.9'], ecuPnos: ['99211-NX400'] }).expect(400);
    expect(bad.body.error.message).toBe('구현 연결을 저장할 수 없습니다 — 기준정보와 맞지 않는 항목 1건');
    expect(bad.body.error.details.blockers[0]).toContain('SW-CARE-SDIST-APP 9.9.9');
    await http().patch(base).set(AUTHOR).send({ swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: [] }).expect(400);
    const ok = await http().patch(base).set(IMPLEMENTER).send({ functions: [{ label: '안전거리 경고 표시' }], ...GOOD }).expect(200);
    expect(ok.body.functions).toEqual([{ functionId: expect.stringMatching(/^FUNC-\d{6}$/), label: '안전거리 경고 표시' }]);
    expect(ok.body._missing).not.toHaveProperty('swIds');
  });

  it('구현을 넣고 정의 승인하면 DEVELOPING에서 검증 완료를 막는 입력 누락이 없다(막다른 길 없음)', async () => {
    const r = await approve(linked);
    expect(r.body.feature?.lifecycle ?? r.body.lifecycle).toBe('DEVELOPING');
    const d = await http().get(`/api/features/${linked}/versions/0.1.0`).expect(200);
    expect(d.body.transitions.find((t: any) => t.to === 'VERIFIED').blockers.map((b: any) => b.code)).not.toContain('INPUT_MISSING');
  });

  it('구현 없이 정의 승인한 Version — 막힌 사유는 한글 칸 이름, 고칠 수 없고(409) 새 Version에 구현을 넣어 이어 간다', async () => {
    const fid = await register('W4 구현 미입력 Feature');
    await approve(fid);
    const d = await http().get(`/api/features/${fid}/versions/0.1.0`).expect(200);
    const msgs = d.body.transitions.find((t: any) => t.to === 'VERIFIED').blockers.map((b: any) => b.message);
    expect(msgs).toEqual(expect.arrayContaining(['필수 입력 누락: 기능(Function)', '필수 입력 누락: SW ID', '필수 입력 누락: SW Version', '필수 입력 누락: 제어기 P/N']));
    expect(msgs.join(' ')).not.toMatch(/swIds|ecuPnos|functions/);
    await http().patch(`/api/features/${fid}/versions/0.1.0`).set(AUTHOR).send({ functions: [{ label: 'x' }], ...GOOD }).expect(409);
    const v = await http().post(`/api/features/${fid}/versions`).set(AUTHOR).send({ baseVersion: '0.1.0', bump: 'minor', reason: '구현 연결 입력', changes: { functions: [{ label: '안전거리 경고' }], ...GOOD } }).expect(201);
    expect(v.body.feature).toMatchObject({ version: '0.2.0', lifecycle: 'PROPOSED', swIds: GOOD.swIds, ecuPnos: GOOD.ecuPnos });
    expect(v.body.feature.functions[0].functionId).toMatch(/^FUNC-\d{6}$/);
  });

  it('검증하지 않은 정책 승인 — 사유는 사실 한 문장(내용이 바뀌었다·개정본이 다르다는 말 없음)', async () => {
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: linked, featureVersion: '0.1.0', controlPoint: 'Flag', flagKey: `care_${linked.slice(5)}_flag`, description: 'W4 시험 Flag', safeDefault: false, enabled: true }).expect(201);
    const d = await http().get(`/api/policies/${c.body.policyId}`).set(APPROVER).expect(200);
    expect(d.body.approval).toMatchObject({ eligible: false, reasons: ['아직 배포 안전성 검증을 하지 않았습니다 — 먼저 분야별 검증을 실행하세요'] });
    const r = await http().post(`/api/policies/${c.body.policyId}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: '승인' }).expect(422);
    expect(r.body.error.message).toBe('승인할 수 없습니다: 아직 배포 안전성 검증을 하지 않았습니다 — 먼저 분야별 검증을 실행하세요');
    expect(r.body.error.message).not.toMatch(/바뀌었습니다|개정본/);
  });

  it('상품 구성 FAIL 문구에 더할 Baseline, 역할 거부는 역할 이름, 구성 승인자 ≠ 고객 출시 승인자(상품 Owner)', async () => {
    const v = await http().post('/api/products/validate').set(P_AUTHOR).send({ country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', type: 'PACKAGE', baselineIds: ['BL-00028', 'BL-00029'] }).expect(200);
    const miss = v.body.issues.find((i: any) => i.code === 'REQUIRES_MISSING');
    expect(miss.suggest).toEqual(['BL-00163']);
    expect(miss.message).toContain('추가할 Baseline: BL-00163');

    const p = await http().post('/api/products').set(P_AUTHOR).send({ name: 'W4 안전거리 패키지', description: 'W4 시험', country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', saleType: '체험', type: 'PACKAGE', baselineIds: ['BL-00028', 'BL-00163'], validFrom: '2026-10-01', validTo: '2026-12-31', ownerId: '선행상품기획팀' }).expect(201);
    const cat = p.body.product.catalogId;
    const to = (who: Record<string, string>, lc: string, code: number) => http().post(`/api/products/${cat}/versions/1.0.0/transitions`).set(who).send({ to: lc, reason: '확인' }).expect(code);
    await to(P_APPROVER, 'APPROVED', 200);
    // 시스템 자동 전이를 사람이 부르면 — 역할 코드(SYSTEM)가 아니라 역할 이름
    expect((await to(P_APPROVER, 'DEVELOPING', 403)).body.error.message).toBe('이 전이는 시스템 역할만 할 수 있습니다.');
    await to(P_APPROVER, 'VERIFIED', 200);
    const sod = await to(P_APPROVER, 'RELEASED', 403);
    expect(sod.body.error.message).toBe('구성 승인자와 고객 출시 승인자는 달라야 합니다.');
    expect((await to(PRODUCT_OWNER, 'RELEASED', 200)).body.product.lifecycle).toBe('RELEASED');
    const meta = (await http().get(`/api/products/${cat}/versions/1.0.0`).expect(200)).body.meta;
    expect(meta).toMatchObject({ createdBy: 'usr-commerce', configApprovedBy: 'usr-approver', releaseApprovedBy: 'usr-productowner' });

    // 새 상품으로 체험 제안 — 시뮬레이터(영상 키트) 차량은 고객 체험에서 뺀다
    const o = await http().post('/api/trials/offers').set(P_AUTHOR).send({ catalogId: cat, vins: ['KMH-NX4-0101', 'lead-01'] }).expect(201);
    expect(o.body.offered.map((g: any) => [g.vin, g.catalogId])).toEqual([['KMH-NX4-0101', cat]]);
    expect(o.body.skipped).toEqual([{ vin: 'lead-01', reason: '시뮬레이터 차량은 고객 체험 대상이 아닙니다' }]);
  });
});
