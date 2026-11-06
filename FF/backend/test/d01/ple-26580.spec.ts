// ISO/IEC 26580 정합(docs/20-architecture/20-60) — 등록 자동 채움·기준 행 추천·출처 이력·변이 프로필·등록 현황·카탈로그·bill-of-features·구성기·공유 자산.
//   자동 채움은 작성 보조 — 등록은 작성자, 정의 승인은 다른 사람(직무 분리 그대로). 서버는 클라이언트 출처 주장을 믿지 않고 대표 행으로 다시 계산한다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PleRepo } from '../../src/domains/d01-policy/ple/ple.repo';
import { PleSeed } from '../../src/domains/d01-policy/ple/ple-seed';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const PRODUCT = actor('park.product', 'PRODUCT_AUTHOR');
const AT = '2026-11-06T01:00:00.000Z';

describe('26580 — Feature 등록 자동 채움', () => {
  let app: INestApplication;
  let http: () => any;
  let repo: PleRepo;
  let seed: PleSeed;
  beforeAll(async () => {
    const b = await bootApp({ at: AT });
    ({ app, http } = b);
    repo = b.get(PleRepo);
    seed = b.get(PleSeed);
  });
  afterAll(() => app.close());

  it('이름·설명 → 기준 행 추천: 사내 용어 SCC가 적응형 순항 제어를 찾는다, 한 글자는 빈 목록', async () => {
    const r = (await http().get('/api/ple/ref-suggestions?q=' + encodeURIComponent('고속도로 SCC 차간 거리')).expect(200)).body;
    expect(r.items[0]).toMatchObject({ refId: 'AD-LON-002' });
    expect(r.items[0].reasons.join(' ')).toContain('사내 용어');
    expect((await http().get('/api/ple/ref-suggestions?q=a').expect(200)).body.items).toEqual([]);
    // 금액 열은 싣지 않는다(산정 역할만 보는 값)
    expect(JSON.stringify(r.items)).not.toMatch(/benchmarkEur|kearneyNote|makeBuy|adminMemo/);
  });

  it('자동 채움 — 칸마다 출처, 적용 범위 후보, 26580 변이 프로필, 없는 행은 404', async () => {
    const r = (await http().get('/api/ple/autofill/AD-LON-002').expect(200)).body;
    const f = Object.fromEntries(r.fields.map((x: any) => [x.key, x]));
    expect(f.asil).toMatchObject({ value: 'B', source: { kind: 'REF', ref: 'AD-LON-002', column: '대표 ASIL(L)' } });
    expect(f.domain.value).toBe('ADAS & AD');
    expect(f.controlPoints.value).toContain('Flag');
    expect(r.scopeCandidates.length).toBeGreaterThan(0);
    expect(['PRIMARY', 'SUB']).toContain(r.variability.catalogueRole);
    await http().get('/api/ple/autofill/ZZ-NONE-999').expect(404);
  });

  it('기준 행 선택만으로 채운 값 그대로 등록 → 칸별 ACCEPTED 이력·변이 프로필 AUTO, 등록 현황 SUBMITTED', async () => {
    const af = (await http().get('/api/ple/autofill/BC-SEAT-001').expect(200)).body;
    const f = Object.fromEntries(af.fields.map((x: any) => [x.key, x.value]));
    // 같은 범위 같은 대표 행·비슷한 이름이 없는 후보 범위
    let scope: any = null;
    for (const s of af.scopeCandidates) {
      const chk = (await http().get(`/api/ple/autofill/BC-SEAT-001?name=${encodeURIComponent(f.name)}&country=${s.country}&vehicleModel=${encodeURIComponent(s.vehicleModel)}&trim=${encodeURIComponent(s.trim)}`).expect(200)).body;
      if (!chk.duplicates.some((d: any) => d.kind === 'SAME_SCOPE' || d.kind === 'SIMILAR_NAME')) { scope = s; break; }
    }
    expect(scope).not.toBeNull();
    const created = (
      await http()
        .post('/api/features')
        .set(AUTHOR)
        .send({ name: f.name, description: f.description, asil: f.asil, tags: f.tags, ...(f.regulations ? { refRegulations: f.regulations } : {}), controlPoints: f.controlPoints, country: scope.country, vehicleModel: scope.vehicleModel, trim: scope.trim, ownerId: f.owner ?? '바디상품기획팀', featureRefs: [{ refId: 'BC-SEAT-001', role: 'PRIMARY' }], variability: af.variability })
        .expect(201)
    ).body;
    const v = (await http().get(`/api/features/${created.featureId}/versions/0.1.0/variability`).expect(200)).body;
    expect(v.source).toBe('AUTO');
    expect(v.variability).toEqual(af.variability);
    const d = Object.fromEntries(v.history.map((h: any) => [h.field, h.decision]));
    expect(d).toMatchObject({ name: 'ACCEPTED', description: 'ACCEPTED', asil: 'ACCEPTED', tags: 'ACCEPTED', controlPoints: 'ACCEPTED', scope: 'ACCEPTED', variability: 'ACCEPTED', owner: f.owner ? 'ACCEPTED' : 'ADDED' });
    expect(v.history.every((h: any) => h.actorId === 'kim.author')).toBe(true);
    expect(v.history.find((h: any) => h.field === 'asil').sourceRef).toBe('BC-SEAT-001 · 대표 ASIL(L)');

    const reg = (await http().get('/api/ple/registrations').set(AUTHOR).expect(200)).body;
    const mine = reg.items.find((x: any) => x.featureId === created.featureId);
    expect(mine).toMatchObject({ stage: 'SUBMITTED', mine: true, primaryRef: { refId: 'BC-SEAT-001' }, autofill: { ACCEPTED: v.history.filter((h: any) => h.decision === 'ACCEPTED').length, EDITED: 0 } });
    expect(mine.missing).toContain('requirementIds'); // 정의 승인 필수 칸이 비었다
    expect(reg.items[0].mine).toBe(true); // 내 등록 먼저

    // 초안에서 이름·변이 프로필을 바꾸면 EDITED 이력이 더해진다(누가·무엇을)
    await http().patch(`/api/features/${created.featureId}/versions/0.1.0`).set(AUTHOR).send({ name: `${f.name} 원격`, variability: { ...af.variability, variability: 'OR' } }).expect(200);
    const v2 = (await http().get(`/api/features/${created.featureId}/versions/0.1.0/variability`).expect(200)).body;
    expect(v2.source).toBe('EDITED');
    expect(v2.variability.variability).toBe('OR');
    expect(v2.history.filter((h: any) => h.decision === 'EDITED').map((h: any) => h.field).sort()).toEqual(['name', 'variability']);
    // Feature 문서에는 변이 프로필이 들어가지 않는다(BOM 기준선 해시 그대로)
    const doc = (await http().get(`/api/features/${created.featureId}/versions/0.1.0`).expect(200)).body;
    expect(JSON.stringify(doc)).not.toContain('"variability":{');
  });

  it('고친 값·후보 밖 범위로 등록하면 EDITED, 잘못된 상위 feature는 400', async () => {
    const af = (await http().get('/api/ple/autofill/BC-SEAT-003').expect(200)).body;
    const base = { name: '요추 지지 맞춤 E2', description: '맞춤 설명', asil: 'QM', tags: ['seat'], controlPoints: ['Flag'], country: 'KR', vehicleModel: 'PLE-TEST', trim: 'Base', ownerId: '바디상품기획팀', featureRefs: [{ refId: 'BC-SEAT-003', role: 'PRIMARY' }] };
    const bad = await http().post('/api/features').set(AUTHOR).send({ ...base, variability: { ...af.variability, catalogueRole: 'SUB', parentRefId: 'BC-SEAT-003' } }).expect(400);
    expect(bad.body.error.message).toContain('다른 기준 행');
    const c = (await http().post('/api/features').set(AUTHOR).send(base).expect(201)).body;
    const v = (await http().get(`/api/features/${c.featureId}/versions/0.1.0/variability`).expect(200)).body;
    const d = Object.fromEntries(v.history.map((h: any) => [h.field, h.decision]));
    expect(d).toMatchObject({ name: 'EDITED', description: 'EDITED', scope: 'EDITED', variability: 'ACCEPTED' });
  });

  it('새 Version은 변이 프로필을 잇는다', async () => {
    const af = (await http().get('/api/ple/autofill/BC-SEAT-002').expect(200)).body;
    const c = (await http().post('/api/features').set(AUTHOR).send({ name: '등받이 리클라인 V', description: 'd', asil: af.fields.find((x: any) => x.key === 'asil').value, controlPoints: ['Flag'], country: 'KR', vehicleModel: 'PLE-VER', trim: 'Base', ownerId: '바디상품기획팀', featureRefs: [{ refId: 'BC-SEAT-002', role: 'PRIMARY' }] }).expect(201)).body;
    const stored = repo.variability(c.featureId, '0.1.0')!;
    expect(stored).toBeTruthy();
    // PROPOSED에서 새 Version은 만들 수 있다(기준 Version 그대로 둠)
    const nv = await http().post(`/api/features/${c.featureId}/versions`).set(AUTHOR).send({ baseVersion: '0.1.0', reason: '변이 프로필 잇기 시험', changes: { description: 'd2' } });
    expect(nv.status, JSON.stringify(nv.body)).toBe(201);
    expect(repo.variability(c.featureId, nv.body.feature.version)?.variability).toEqual(stored.variability);
  });

  it('데모 시드 — 기준 행 연결 Feature마다 한 번, 다시 부르면 0', () => {
    expect(repo.countVariabilities()).toBeGreaterThan(40);
    expect(seed.run()).toBe(0);
  });
});

describe('26580 — 카탈로그·bill-of-features·구성기·공유 자산', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: AT }));
  });
  afterAll(() => app.close());

  it('카탈로그 트리 — 도메인·주요 feature·실현 Feature가 비지 않는다', async () => {
    const t = (await http().get('/api/ple/catalogue').expect(200)).body;
    expect(t.counts.domains).toBeGreaterThan(2);
    expect(t.counts.primary).toBeGreaterThan(10);
    expect(t.counts.sub).toBeGreaterThan(5); // 포함으로만 쓰인 행 = 하위 feature
    expect(t.counts.realizations).toBeGreaterThan(40);
    expect(t.counts.variationPoints).toBeGreaterThan(40);
  });

  it('bill-of-features 포트폴리오 — 모든 상품, 상품마다 고른 feature', async () => {
    const p = (await http().get('/api/ple/bill-of-features').expect(200)).body;
    expect(p.counts.products).toBeGreaterThan(10);
    expect(p.items.filter((i: any) => i.features > 0).length).toBe(p.items.length);
    const one = p.items[0];
    const b = (await http().get(`/api/ple/bill-of-features/${one.catalogId}/${one.version}`).expect(200)).body;
    expect(b.selections.length).toBe(one.features);
    expect(b.composition).toBeTruthy();
    await http().get('/api/ple/bill-of-features/CAT-99999/1.0.0').expect(404);
  });

  it('bill-of-features 점검 — Feature 간 REQUIRES가 빠진 구성은 FAIL, 상품 역할만', async () => {
    const deps = (await http().get('/api/dependencies?type=REQUIRES').expect(200)).body.items as any[];
    const bls = (await http().get('/api/baselines').expect(200)).body.items as any[];
    // 출처 Feature에 확정 Baseline이 있는 REQUIRES 하나 — 대상은 빼고 출처만 고른다
    const dep = deps.find((d) => bls.some((b) => b.featureId === d.sourceFeatureId && b.version === d.sourceVersion));
    const b = bls.find((x) => x.featureId === dep.sourceFeatureId && x.version === dep.sourceVersion);
    const s = b.snapshot ?? b;
    const body = { country: s.country, vehicleModel: s.vehicleModel, trim: s.trim, type: 'SINGLE', baselineIds: [b.baselineId] };
    const r = (await http().post('/api/ple/bill-of-features/check').set(PRODUCT).send(body).expect(200)).body;
    expect(r.result).toBe('FAIL');
    expect(r.issues.map((i: any) => i.code)).toContain('REQUIRES_MISSING');
    await http().post('/api/ple/bill-of-features/check').set(AUTHOR).send(body).expect(403);
  });

  it('제품 구성기 — 고른 Feature는 Flag 켬, SW 컴포넌트 인스턴스, 공유 자산 추적', async () => {
    const p = (await http().get('/api/ple/bill-of-features').expect(200)).body;
    const one = p.items[0];
    const c = (await http().get(`/api/ple/configure/${one.catalogId}/${one.version}`).expect(200)).body;
    expect(c.bill.selections.length).toBe(one.features);
    expect(c.instances.flags.some((f: any) => f.value === 'ON')).toBe(true);
    expect(c.instances.variationPoints.length).toBeGreaterThan(0);
    const a = (await http().get('/api/ple/assets').expect(200)).body;
    expect(a.counts.swComponents).toBeGreaterThan(5);
    expect(a.counts.shared).toBeGreaterThan(0);
  });
});
