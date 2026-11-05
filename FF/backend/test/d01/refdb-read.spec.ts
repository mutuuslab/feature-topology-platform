// Feature DB 읽기 API(30-95 §6.1·§8.4) — 검색(한글·영문·별칭·용어집·ID)·패싯·페이지·상세(분류 경로·출처·세부기능 후보·연결 Feature·상태 안내)·
// 품질 지표, 벤치마크 필드(금액·Make/Buy)는 Feature DB 관리자만(산정 역할 전, 20-94 §8).
import { INestApplication } from '@nestjs/common';
import { REF_MONEY_FIELDS } from '@ff/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const STEWARD = actor('usr-steward', 'REFDB_ADMIN');

describe('Feature DB 읽기', () => {
  let app: INestApplication;
  let http: Awaited<ReturnType<typeof bootApp>>['http'];
  beforeAll(async () => ({ app, http } = await bootApp()));
  afterAll(() => app.close());

  const search = async (query: Record<string, string | number>, who = AUTHOR) => (await http().get('/api/refdb/refs').query(query).set(who).expect(200)).body;

  describe('검색', () => {
    it('한글 기능명(띄어쓰기 무시) — 오토 홀드 / 오토홀드', async () => {
      for (const q of ['오토 홀드', '오토홀드']) {
        const r = await search({ q });
        expect(r.items[0].refId).toBe('CH-BRK-009');
        expect(r.items[0].nameKo).toBe('오토 홀드');
      }
    });

    it('별칭(대소문자 무시) — power SEAT → 전동 시트 BC-SEAT-001, 전동시트도 같은 행', async () => {
      expect((await search({ q: 'power SEAT' })).items[0].refId).toBe('BC-SEAT-001');
      expect((await search({ q: '전동시트' })).items.map((i: { refId: string }) => i.refId)).toContain('BC-SEAT-001');
    });

    it('사내 용어집 — 뜻(전자식 주차 브레이크)으로도 찾는다, ID 일부(ch-brk-00)도', async () => {
      expect((await search({ q: '전자식 주차' })).items.map((i: { refId: string }) => i.refId)).toContain('CH-BRK-008');
      const byId = await search({ q: 'ch-brk-00' });
      expect(byId.total).toBe(9);
      expect(byId.items.every((i: { refId: string }) => i.refId.startsWith('CH-BRK-00'))).toBe(true);
    });

    it('결과 행에 상태·대표 ASIL·T-shirt·세부기능 후보 수', async () => {
      const it0 = (await search({ q: 'AVH' })).items[0];
      expect(it0).toMatchObject({ refId: 'CH-BRK-009', status: 'ACTIVE', asilRep: expect.any(String), tshirt: expect.any(String), subfunctionCount: 48 });
    });

    it('페이지 — offset·limit, 전체 수는 그대로', async () => {
      const a = await search({ limit: 10 });
      const b = await search({ limit: 10, offset: 10 });
      expect(a).toMatchObject({ total: 1052, offset: 0, limit: 10, release: 'v1.3' });
      expect(b.total).toBe(1052);
      expect(b.items).toHaveLength(10);
      expect(b.items[0].refId).not.toBe(a.items[0].refId);
      expect((await search({})).limit).toBe(50);
      expect((await search({ limit: 9999 })).limit).toBe(200);
    });

    it('패싯 — 상태 995·53·4, 도메인 합 1,052; 도메인을 고르면 도메인 패싯은 그대로·컴포넌트 패싯은 그 도메인 안', async () => {
      const all = await search({ limit: 1 });
      expect(all.facets.status).toEqual({ ACTIVE: 995, REVIEW: 53, DEPRECATED: 4, RETIRED: 0, PENDING: 0 });
      expect(Object.values(all.facets.domain as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(1052);
      expect(Object.keys(all.facets.domain)).toHaveLength(10);
      expect(Object.keys(all.facets.component)).toHaveLength(69);

      const ch = await search({ domain: 'Chassis & Vehicle Dynamics', limit: 1 });
      expect(ch.total).toBe(66);
      expect(ch.facets.domain).toEqual(all.facets.domain);
      expect(Object.values(ch.facets.component as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(66);
      expect(ch.facets.component['Brake control (ESC/ABS)']).toBeGreaterThan(0);

      const dep = await search({ status: 'DEPRECATED' });
      expect(dep.total).toBe(4);
      expect(dep.facets.status.ACTIVE).toBe(995); // 상태 패싯은 상태 필터를 빼고 센다
      const brk = await search({ component: 'Brake control (ESC/ABS)', q: '홀드' });
      expect(brk.items.map((i: { refId: string }) => i.refId)).toContain('CH-BRK-009');
    });

    it('잘못된 질의 — 없는 상태·음수 offset·같은 질의 두 번은 400', async () => {
      await http().get('/api/refdb/refs?status=GONE').set(AUTHOR).expect(400);
      await http().get('/api/refdb/refs?offset=-1').set(AUTHOR).expect(400);
      await http().get('/api/refdb/refs?q=a&q=b').set(AUTHOR).expect(400);
    });
  });

  describe('상세', () => {
    it('분류 경로·출처·용어집·세부기능 후보·상태 안내', async () => {
      const d = (await http().get('/api/refdb/refs/CH-BRK-009').set(AUTHOR).expect(200)).body;
      expect(d.ref.refId).toBe('CH-BRK-009');
      expect(d.taxonomy.domain).toMatchObject({ nodeId: 'CH', level: 'DOMAIN' });
      expect(d.taxonomy.cluster).toMatchObject({ nodeId: 'CH:Brake control', level: 'CLUSTER' });
      expect(d.taxonomy.component).toMatchObject({ level: 'COMPONENT', abbr: 'BRK' });
      expect(d.sources).toEqual([{ sourceId: 'S10', source: expect.objectContaining({ sourceId: 'S10' }) }]);
      expect(d.glossary.map((g: { term: string }) => g.term)).toEqual(['AVH']);
      expect(d.subfunctions).toHaveLength(48);
      expect(d.policy).toMatchObject({ status: 'ACTIVE', selectable: true, blocksApproval: false, ko: '활성', replacedBy: null });
    });

    it('이 행을 쓰는 시드 Feature — FEAT-00001(원격 스마트 주차 보조)의 두 버전이 대표로 연결', async () => {
      const d = (await http().get('/api/refdb/refs/AD-PRK-007').set(AUTHOR).expect(200)).body;
      const mine = d.usedBy.filter((f: { featureId: string }) => f.featureId === 'FEAT-00001');
      expect(mine.map((f: { version: string }) => f.version)).toEqual(['2.1.0', '2.2.0']);
      expect(mine[0]).toMatchObject({ role: 'PRIMARY', refVersion: 'v1.3', name: '원격 스마트 주차 보조', lifecycle: expect.any(String) });
    });

    it('폐기 예정 행 — 경고 안내', async () => {
      const d = (await http().get('/api/refdb/refs/PL-CP-023').set(AUTHOR).expect(200)).body;
      expect(d.policy).toMatchObject({ status: 'DEPRECATED', warn: true, selectable: true, ko: '폐기 예정' });
    });

    it('없는 행은 404', async () => {
      await http().get('/api/refdb/refs/ZZ-NONE-001').set(AUTHOR).expect(404);
    });
  });

  describe('벤치마크 필드(금액·Make/Buy)', () => {
    const hidden = (row: Record<string, unknown>) => REF_MONEY_FIELDS.every((k) => !(k in row));

    it('Feature 작성자·익명 조회(감사 조회자)에게는 목록·상세·내보내기 모두 필드 자체가 없다', async () => {
      for (const who of [AUTHOR, {}]) {
        const d = (await http().get('/api/refdb/refs/BC-BCM-001').set(who).expect(200)).body;
        expect(hidden(d.ref)).toBe(true);
        const l = (await http().get('/api/refdb/refs').query({ q: 'BC-BCM-001' }).set(who).expect(200)).body;
        expect(hidden(l.items[0])).toBe(true);
        const ex = (await http().get('/api/refdb/export').set(who).expect(200)).body;
        expect(ex.refs.every(hidden)).toBe(true);
      }
    });

    it('Feature DB 관리자에게는 보인다', async () => {
      const d = (await http().get('/api/refdb/refs/BC-BCM-001').set(STEWARD).expect(200)).body;
      expect(d.ref).toMatchObject({ benchmarkEur: 100000 });
      for (const k of REF_MONEY_FIELDS) expect(d.ref).toHaveProperty(k);
      const l = (await http().get('/api/refdb/refs').query({ q: 'BC-BCM-001' }).set(STEWARD).expect(200)).body;
      expect(l.items[0].benchmarkEur).toBe(100000);
    });
  });

  it('품질 지표 — 출처 없는 행 0·상태 미입력 0·발행 대기 0·연결 확인 필요 8', async () => {
    const q = (await http().get('/api/refdb/quality').expect(200)).body;
    expect(q).toMatchObject({ total: 1052, statusMissing: 0, noSource: 0, awaitingPublish: 0, latestRelease: 'v1.3' });
    expect(q.sizeGradeDShare).toBeGreaterThan(0.5);
    expect(q.needsLink.total).toBe(8);
  });

  it('세부기능 후보 — 컴포넌트로 거른다', async () => {
    const r = (await http().get('/api/refdb/subfunctions').query({ component: 'Brake control (ESC/ABS)' }).expect(200)).body;
    expect(r.items).toHaveLength(48);
    expect(r.items.every((s: { component: string }) => s.component === 'Brake control (ESC/ABS)')).toBe(true);
  });
});
