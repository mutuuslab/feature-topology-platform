// Feature DB(30-95) — 엑셀 v1.3 이전 시드, 검색·상세, 등록 때 연결 필수(D-REF-3), ASIL 사유(§6.3),
// 같은 범위 중복(D-REF-13), 추가 요청 → 요청 중 행(D-REF-7), 요청 중 행은 승인 전이를 막는다.
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp } from '../helpers';
import { refFor } from '../feature-refs';
import { migrate, SqliteDb } from '../../src/kernel/db';
import { applySeed } from '../../src/kernel/db-open';
import { MIGRATIONS } from '../../src/kernel/migrations';
import { seedFeatureDb } from '../../src/kernel/seed';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');

const body = (over: Record<string, unknown> = {}) => ({
  name: `Feature DB 시험 ${Math.random().toString(36).slice(2, 8)}`,
  description: 'Feature DB 연결 시험',
  requirementIds: ['REQ-REF-1'],
  country: 'KR',
  vehicleModel: 'NX4 PE',
  trim: 'Premium',
  ownerId: '제동개발팀',
  asil: 'B',
  ...over,
});

describe('Feature DB (D01-01, 30-95)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp()));
  afterAll(() => app.close());

  describe('엑셀 v1.3 이전 시드와 조회', () => {
    it('1,052행·상태별 995/53/4·발행 v1.3 — 엑셀 15_DB운영 품질 지표와 같다', async () => {
      const o = (await http().get('/api/refdb/overview').expect(200)).body;
      expect(o.release).toBe('v1.3');
      expect(o.quality).toMatchObject({ total: 1052, byStatus: { ACTIVE: 995, REVIEW: 53, DEPRECATED: 4, RETIRED: 0, PENDING: 0 }, noSource: 0 });
      expect(o.domains).toHaveLength(10);
    });

    it('분류는 도메인 10 · 컴포넌트 69 — 컴포넌트 열을 클러스터 열과 헷갈리지 않는다', async () => {
      const t = (await http().get('/api/refdb/taxonomy').expect(200)).body.items as { level: string; name: string; abbr: string | null }[];
      expect(t.filter((x) => x.level === 'DOMAIN')).toHaveLength(10);
      const comps = t.filter((x) => x.level === 'COMPONENT');
      expect(comps).toHaveLength(69);
      expect(comps.map((c) => c.name)).toContain('Body controller');
      expect(comps.every((c) => c.abbr)).toBe(true);
    });

    it('별칭(사내 용어 AVH)·한글 이름으로 찾고, 금액 필드는 응답에 없다', async () => {
      const byAlias = (await http().get('/api/refdb/refs?q=AVH').expect(200)).body;
      expect(byAlias.items[0]).toMatchObject({ refId: 'CH-BRK-009', nameKo: '오토 홀드', asilRep: 'B', tshirt: 'S' });
      const byName = (await http().get(`/api/refdb/refs?q=${encodeURIComponent('오토 홀드')}`).expect(200)).body;
      expect(byName.items[0].refId).toBe('CH-BRK-009');
      const d = (await http().get('/api/refdb/refs/BC-BCM-001').expect(200)).body;
      expect(d.ref).not.toHaveProperty('benchmarkEur');
      expect(byName.items[0]).not.toHaveProperty('benchmarkEur');
      expect(d.sources.map((s: { sourceId: string }) => s.sourceId)).toContain('S01');
    });

    it('도메인·상태로 거른다, 없는 상태는 400, 없는 행은 404', async () => {
      const review = (await http().get('/api/refdb/refs?status=REVIEW&limit=200').expect(200)).body;
      expect(review.total).toBe(53);
      const body2 = (await http().get(`/api/refdb/refs?domain=${encodeURIComponent('Safety')}&limit=200`).expect(200)).body;
      expect(body2.total).toBe(40);
      await http().get('/api/refdb/refs?status=NOPE').expect(400);
      await http().get('/api/refdb/refs/XX-NOPE-001').expect(404);
    });
  });

  describe('Feature 등록 때 연결 필수 (D-REF-3)', () => {
    it('연결 없이 등록하면 400, 대표가 둘이거나 없는 행이면 400', async () => {
      await http().post('/api/features').set(AUTHOR).send(body()).expect(400);
      const two = await http()
        .post('/api/features')
        .set(AUTHOR)
        .send(body({ featureRefs: [{ refId: refFor('B'), role: 'PRIMARY' }, { refId: refFor('B'), role: 'PRIMARY' }] }))
        .expect(400);
      expect(JSON.stringify(two.body)).toContain('대표 기준 행');
      const missing = await http().post('/api/features').set(AUTHOR).send(body({ featureRefs: [{ refId: 'CH-BRK-999', role: 'PRIMARY' }] })).expect(400);
      expect(missing.body.error.details).toMatchObject({ field: 'featureRefs' });
    });

    it('ASIL이 대표 기준 행과 다르면 사유가 있어야 한다 — 사유와 함께면 등록되고 연결·발행 버전이 남는다', async () => {
      const ref = refFor('QM');
      const no = await http().post('/api/features').set(AUTHOR).send(body({ asil: 'B', featureRefs: [{ refId: ref, role: 'PRIMARY' }] })).expect(400);
      expect(no.body.error.details).toMatchObject({ field: 'asilDeviationReason', refAsil: 'QM' });
      const ok = await http()
        .post('/api/features')
        .set(AUTHOR)
        .send(body({ asil: 'B', asilDeviationReason: '이 차종은 제동 개입이 있어 B로 올림', featureRefs: [{ refId: ref, role: 'PRIMARY' }, { refId: 'BC-BCM-002', role: 'INCLUDED' }] }))
        .expect(201);
      expect(ok.body.featureRefs).toEqual([
        { refId: ref, role: 'PRIMARY', refRelease: 'v1.3' },
        { refId: 'BC-BCM-002', role: 'INCLUDED', refRelease: 'v1.3' },
      ]);
      const d = (await http().get(`/api/refdb/refs/${ref}`).expect(200)).body;
      expect(d.usedBy).toContainEqual({ featureId: ok.body.featureId, version: '0.1.0', role: 'PRIMARY' });
    });

    it('같은 국가·차종·트림에 같은 대표 기준 행이면 409 — 이유를 적으면 등록된다', async () => {
      const ref = refFor('B');
      await http().post('/api/features').set(AUTHOR).send(body({ featureRefs: [{ refId: ref, role: 'PRIMARY' }] })).expect(201);
      const dup = await http().post('/api/features').set(AUTHOR).send(body({ featureRefs: [{ refId: ref, role: 'PRIMARY' }] })).expect(409);
      expect(dup.body.error.details).toMatchObject({ field: 'duplicateReason' });
      await http()
        .post('/api/features')
        .set(AUTHOR)
        .send(body({ duplicateReason: '레이더 사양이 다른 하드웨어 변형', featureRefs: [{ refId: ref, role: 'PRIMARY' }] }))
        .expect(201);
    });

    it('초안 수정으로 연결을 바꾸면 역참조 색인도 바뀌고, 새 Version은 연결을 잇는다', async () => {
      const a = refFor('B');
      const b = refFor('B');
      const f = (await http().post('/api/features').set(AUTHOR).send(body({ featureRefs: [{ refId: a, role: 'PRIMARY' }] })).expect(201)).body;
      await http().patch(`/api/features/${f.featureId}/versions/0.1.0`).set(AUTHOR).send({ featureRefs: [{ refId: b, role: 'PRIMARY' }] }).expect(200);
      expect((await http().get(`/api/refdb/refs/${a}`).expect(200)).body.usedBy.find((u: { featureId: string }) => u.featureId === f.featureId)).toBeUndefined();
      expect((await http().get(`/api/refdb/refs/${b}`).expect(200)).body.usedBy).toContainEqual({ featureId: f.featureId, version: '0.1.0', role: 'PRIMARY' });
    });
  });

  describe('Feature DB에 없는 기능 — 추가 요청 (D-REF-7)', () => {
    it('정식 형식 ID를 바로 받고(다음 일련번호) 요청 중 행으로 등록에 쓸 수 있지만, 승인 전이는 막힌다', async () => {
      const r = await http()
        .post('/api/refdb/requests')
        .set(AUTHOR)
        .send({ domain: 'Chassis & Vehicle Dynamics', cluster: 'Brake control', component: 'Brake control (ESC/ABS)', nameEn: 'Hill descent hold', nameKo: '내리막 정차 유지', tshirt: 'S', asilRep: 'B', evidence: 'UN R13-H 부속서 검토 중' })
        .expect(201);
      expect(r.body).toMatchObject({ status: 'PENDING', refId: expect.stringMatching(/^CH-BRK-\d{3}$/) });
      expect(r.body).not.toHaveProperty('benchmarkEur');
      const o = (await http().get('/api/refdb/overview').expect(200)).body;
      expect(o.pendingRequests).toBe(1);
      const f = (await http().post('/api/features').set(AUTHOR).send(body({ featureRefs: [{ refId: r.body.refId, role: 'PRIMARY' }] })).expect(201)).body;
      const d = (await http().get(`/api/features/${f.featureId}/versions/0.1.0`).set(APPROVER).expect(200)).body;
      const approve = d.transitions.find((t: { to: string }) => t.to === 'APPROVED');
      expect(approve.blockers.map((b: { code: string }) => b.code)).toContain('FEATURE_REF_BLOCKED');
    });

    it('없는 컴포넌트는 400 — 새 컴포넌트는 관리자가 분류를 먼저 추가한다', async () => {
      await http()
        .post('/api/refdb/requests')
        .set(AUTHOR)
        .send({ domain: 'Safety', cluster: 'x', component: 'Teleport control', nameEn: 'x', nameKo: 'x', tshirt: 'S', asilRep: 'QM', evidence: 'x' })
        .expect(400);
    });

    it('작성 역할이 아니면 요청할 수 없다', async () => {
      await http().post('/api/refdb/requests').set(APPROVER).send({}).expect(403);
    });
  });
});

describe('Feature DB는 고객 설치(FF_SEED=none)에도 들어간다 (30-95 §9)', () => {
  it('데모 시드 없이 부팅 시드를 돌려도 1,052행·발행 v1.3, 데모 Feature는 0', () => {
    const db = new SqliteDb(':memory:');
    try {
      migrate(db, MIGRATIONS);
      applySeed(db, { FF_SEED: 'none' });
      expect(db.get<{ n: number }>('SELECT count(*) AS n FROM feature_ref')?.n).toBe(1052);
      expect(db.get<{ release: string }>('SELECT release FROM ref_release')?.release).toBe('v1.3');
      expect(db.get<{ n: number }>('SELECT count(*) AS n FROM feature_version')?.n).toBe(0);
      // 두 번 돌려도 다시 넣지 않는다 — 운영 중 변경을 덮어쓰지 않는다
      expect(seedFeatureDb(db)).toBe(0);
    } finally {
      db.close();
    }
  });
});
