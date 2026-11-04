// Feature DB 첫 기동 시드(30-95 §9) — 빈 DB에 v1.3(엑셀 가져옴)을 넣고, 시드 Feature를 대응표로 연결한다.
// 이미 기준 행이 있는 DB에는 다시 쓰지 않는다(FF가 원천). FF_SEED=none(고객 설치)도 v1.3을 받되 시드 연결은 없다.
// FF_REFDB_SEED=off면 빈 Feature DB로 시작한다.
import { INestApplication } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { FeatureVersionRow } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { REFDB_SEED_DIR, REFDB_SEED_LINKS, readSeedRecord, refdbSeedEnabled, seedRefdb } from '../../src/domains/d01-policy/refdb/refdb-seed';
import { RefdbRepository } from '../../src/domains/d01-policy/refdb/refdb.repository';
import { DB, type Db } from '../../src/kernel/db';
import { bootApp } from '../helpers';

const MISSING = ['FEAT-00022', 'FEAT-00023', 'FEAT-00025', 'FEAT-00026', 'FEAT-00028', 'FEAT-00029', 'FEAT-00031', 'FEAT-00032'];
const seedLinks = JSON.parse(readFileSync(REFDB_SEED_LINKS, 'utf8')) as { links: Record<string, { refId: string; role: string }[]> };

/** FF_SEED·FF_DB를 직접 고른 부팅(bootApp은 v0.81 메모리 DB 고정) */
async function boot(env: { FF_SEED: string; FF_DB: string; FF_REFDB_SEED?: string }) {
  Object.assign(process.env, env);
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = mod.createNestApplication(new ExpressAdapter(), { logger: false });
  await app.init();
  return { app, http: () => request(app.getHttpServer()), db: app.get<Db>(DB), repo: app.get(RefdbRepository) };
}

describe('Feature DB 시드 — 데모(FF_SEED v0.81)', () => {
  let app: INestApplication;
  let db: Db;
  let repo: RefdbRepository;
  let http: () => ReturnType<typeof request>;
  beforeAll(async () => {
    const b = await bootApp();
    ({ app, http } = b);
    db = b.get<Db>(DB);
    repo = b.get(RefdbRepository);
  });
  afterAll(() => app.close());

  it('v1.3 기준 행 1,052개와 상태 수(활성 995·검토 필요 53·폐기 예정 4)', async () => {
    expect(repo.countRefs()).toBe(1052);
    const q = (await http().get('/api/refdb/quality').expect(200)).body;
    expect(q.total).toBe(1052);
    expect(q.byStatus).toEqual({ ACTIVE: 995, REVIEW: 53, DEPRECATED: 4, RETIRED: 0, PENDING: 0 });
    expect(q.latestRelease).toBe('v1.3');
  });

  it('딸린 표 — 분류 145(도메인 10·컴포넌트 69)·출처 73·용어집 3·세부기능 후보 840', async () => {
    const tax = (await http().get('/api/refdb/taxonomy').expect(200)).body.items as { level: string; nodeId: string }[];
    expect(tax).toHaveLength(145);
    expect(tax.filter((n) => n.level === 'DOMAIN')).toHaveLength(10);
    expect(tax.filter((n) => n.level === 'COMPONENT')).toHaveLength(69);
    // 클러스터·컴포넌트 이름이 같은 4쌍도 노드 ID가 겹치지 않게 들어간다
    expect(new Set(tax.map((n) => n.nodeId)).size).toBe(145);
    expect((await http().get('/api/refdb/sources').expect(200)).body.items).toHaveLength(73);
    expect(repo.glossary()).toHaveLength(3);
    const subs = (await http().get('/api/refdb/subfunctions').expect(200)).body.items;
    expect(subs).toHaveLength(840);
    expect(subs[0]).toHaveProperty('subfunctionId'); // 가져오기의 추가 열은 그대로
  });

  it("발행 v1.3 '(엑셀 가져옴)' — manifest.json 원문 해시, 발행자는 시드", async () => {
    const rel = (await http().get('/api/refdb/releases').expect(200)).body.items;
    expect(rel).toHaveLength(1);
    expect(rel[0]).toMatchObject({ release: 'v1.3', publishedBy: 'system:refdb-seed', changeIds: [] });
    expect(rel[0].hash).toBe(createHash('sha256').update(readFileSync(join(REFDB_SEED_DIR, 'manifest.json'), 'utf8')).digest('hex'));
    expect(rel[0].note).toContain('엑셀 가져옴');
  });

  it('시드 Feature 연결 — 대응표의 60개 Feature(72개 버전) doc.featureRefs와 연결 색인', () => {
    let versions = 0;
    for (const [featureId, links] of Object.entries(seedLinks.links)) {
      for (const v of repo.featureVersionDocs(featureId)) {
        const doc = FeatureVersionRow.parse(JSON.parse(v.doc));
        expect(doc.featureRefs?.map((l) => [l.refId, l.role, l.refVersion])).toEqual(links.map((l) => [l.refId, l.role, 'v1.3']));
        expect(repo.linksOf(featureId, v.version)).toHaveLength(links.length);
        versions++;
      }
    }
    expect(Object.keys(seedLinks.links)).toHaveLength(60);
    expect(versions).toBe(72);
    expect(db.get<{ n: number }>('SELECT count(DISTINCT feature_id) AS n FROM feature_ref_link')!.n).toBe(60);
  });

  it("대응표에 없는 8개는 연결을 지어내지 않고 '확인 필요'(사유·후보)로 남긴다", async () => {
    for (const id of MISSING) {
      for (const v of repo.featureVersionDocs(id)) {
        const doc = FeatureVersionRow.parse(JSON.parse(v.doc));
        expect(doc.featureRefs).toBeUndefined();
        expect(doc._missing.featureRefs).toBe('미입력');
        expect(repo.linksOf(id, v.version)).toEqual([]);
      }
    }
    expect(readSeedRecord(repo)?.missing.map((m) => m.featureId)).toEqual(MISSING);
    const q = (await http().get('/api/refdb/quality').expect(200)).body;
    expect(q.needsLink.total).toBe(8);
    expect(q.needsLink.items.map((i: { featureId: string }) => i.featureId)).toEqual(MISSING);
    const first = q.needsLink.items[0];
    expect(first.name).toBe('전방 안전거리 3단계');
    expect(first.note).toContain('확정 필요');
    expect(first.candidates).toEqual(['AD-LON-009', 'AD-LON-002']);
  });

  it('기준 행이 이미 있으면 다시 가져오지 않는다 — 시드 함수를 다시 불러도 그대로', () => {
    const before = repo.getRef('CH-BRK-009')!;
    repo.updateRef({ ...before, nameKo: '오토 홀드(FF 수정)' }, '2026-11-04T00:00:00Z');
    expect(seedRefdb(db, repo, { at: '2026-11-05T00:00:00Z', linksPath: REFDB_SEED_LINKS })).toEqual({ seeded: false, skipped: 'NOT_EMPTY' });
    expect(repo.countRefs()).toBe(1052);
    expect(repo.releases()).toHaveLength(1);
    expect(repo.getRef('CH-BRK-009')!.nameKo).toBe('오토 홀드(FF 수정)');
    repo.updateRef(before, '2026-11-04T00:00:00Z');
  });
});

describe('Feature DB 시드 — 재기동(파일 DB)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ff-refdb-seed-'));
  const file = join(dir, 'ff.db');
  afterAll(() => {
    delete process.env.FF_DB;
    delete process.env.FF_SEED;
    rmSync(dir, { recursive: true, force: true });
  });

  it('FF에서 고친 기준 행은 재기동해도 엑셀 값으로 되돌아가지 않는다(발행 1건 그대로)', async () => {
    const a = await boot({ FF_SEED: 'v0.81', FF_DB: file });
    const row = a.repo.getRef('BC-BCM-001')!;
    a.repo.updateRef({ ...row, adminMemo: 'CR-2026-001 반영' }, '2026-11-04T00:00:00Z');
    await a.app.close();
    const b = await boot({ FF_SEED: 'v0.81', FF_DB: file });
    try {
      expect(b.repo.countRefs()).toBe(1052);
      expect(b.repo.getRef('BC-BCM-001')!.adminMemo).toBe('CR-2026-001 반영');
      expect(b.repo.releases()).toHaveLength(1);
      expect(b.repo.subfunctions()).toHaveLength(840);
    } finally {
      await b.app.close();
    }
  });
});

describe('Feature DB 시드 — FF_SEED=none(고객 설치)', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let db: Db;
  let repo: RefdbRepository;
  beforeAll(async () => ({ app, http, db, repo } = await boot({ FF_SEED: 'none', FF_DB: ':memory:' })));
  afterAll(async () => {
    await app.close();
    delete process.env.FF_SEED;
  });

  it('데모 데이터 없이도 빈 Feature DB는 v1.3(기준 행 1,052개·발행 1건)을 받는다 — 30-95 §9', async () => {
    expect(repo.countRefs()).toBe(1052);
    const list = (await http().get('/api/refdb/refs').expect(200)).body;
    expect(list).toMatchObject({ total: 1052, release: 'v1.3' });
    expect((await http().get('/api/refdb/taxonomy').expect(200)).body.items).toHaveLength(145);
    expect((await http().get('/api/refdb/subfunctions').expect(200)).body.items).toHaveLength(840);
    const rel = (await http().get('/api/refdb/releases').expect(200)).body.items;
    expect(rel).toHaveLength(1);
    expect(rel[0]).toMatchObject({ release: 'v1.3', publishedBy: 'system:refdb-seed' });
    await http().get('/api/refdb/refs/CH-BRK-009').expect(200);
  });

  it('시드 Feature가 없으므로 연결·확인 필요 목록은 비어 있다', async () => {
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM feature_ref_link')!.n).toBe(0);
    const rec = readSeedRecord(repo);
    expect(rec).toMatchObject({ release: 'v1.3', refs: 1052, linkedVersions: 0, missing: [] });
    const q = (await http().get('/api/refdb/quality').expect(200)).body;
    expect(q).toMatchObject({ total: 1052, latestRelease: 'v1.3', needsLink: { total: 0, items: [] } });
  });
});

describe('Feature DB 시드 — FF_REFDB_SEED=off', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  beforeAll(async () => ({ app, http } = await boot({ FF_SEED: 'none', FF_DB: ':memory:', FF_REFDB_SEED: 'off' })));
  afterAll(async () => {
    await app.close();
    delete process.env.FF_SEED;
    delete process.env.FF_REFDB_SEED;
  });

  it('빈 Feature DB — 기준 행·분류·출처·발행·세부기능 후보 모두 빈 목록, 조회 API는 정상 응답', async () => {
    const list = (await http().get('/api/refdb/refs').expect(200)).body;
    expect(list).toMatchObject({ items: [], total: 0, offset: 0, release: null });
    expect(list.facets.status).toEqual({ ACTIVE: 0, REVIEW: 0, DEPRECATED: 0, RETIRED: 0, PENDING: 0 });
    for (const path of ['/api/refdb/taxonomy', '/api/refdb/sources', '/api/refdb/releases', '/api/refdb/subfunctions']) expect((await http().get(path).expect(200)).body.items).toEqual([]);
    const q = (await http().get('/api/refdb/quality').expect(200)).body;
    expect(q).toMatchObject({ total: 0, latestRelease: null, needsLink: { total: 0, items: [] } });
    await http().get('/api/refdb/refs/CH-BRK-009').expect(404);
    expect((await http().get('/api/refdb/export').expect(200)).body).toMatchObject({ release: null, refs: [] });
  });

  it('refdbSeedEnabled — off·0·false(대소문자 무시)만 끈다', () => {
    for (const v of ['off', 'OFF', '0', 'false', ' off ']) expect(refdbSeedEnabled({ FF_REFDB_SEED: v })).toBe(false);
    for (const v of [undefined, '', 'on', '1']) expect(refdbSeedEnabled({ FF_REFDB_SEED: v })).toBe(true);
  });
});
