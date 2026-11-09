// Feature DB 하네스 정합 검사(30-95) — 계약(routes·권한·직무 분리)과 실제 앱·시드 데이터가 서로 어긋나지 않는지 한곳에서 본다.
//  (a) ROUTES의 /api/refdb 경로마다 Nest 처리기가 있고, 처리기가 읽는 질의 이름이 routes.ts query와 같다(전체 양방향은 routes.spec).
//  (b) IAM 권한표(rolesView)에서 Feature DB 관리자·도메인 검토자의 Feature DB 쓰기 권한이 정확히 정해진 묶음이다.
//  (c) 직무 분리 SOD-13·14·15가 규칙표에 있다 — 서버 강제(403·감사 DENIED)는 refdb-change.spec.ts·refdb-governance.spec.ts가 본다.
//  (d) 시드 데이터 — 기준 행 수 = manifest 행 수, 대응표 refId 실재, 연결된 시드 Feature의 ASIL = 대표 행 대표 ASIL 또는 asilDeviation 사유.
//      (d)의 ASIL 불일치는 0건이어야 한다 — 사유는 from·to가 대표 행 대표 ASIL·버전 ASIL과 맞아야 인정한다.
import { INestApplication, RequestMethod } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { FeatureVersionRow, rolesView, ROUTES, routeKey, SOD_RULES, type RouteDef } from '@ff/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REFDB_SEED_DIR, REFDB_SEED_LINKS } from '../../src/domains/d01-policy/refdb/refdb-seed';
import { RefdbRepository } from '../../src/domains/d01-policy/refdb/refdb.repository';
import { DB, type Db } from '../../src/kernel/db';
import { bootApp } from '../helpers';

const REFDB_ROUTES = ROUTES.filter((r) => r.path.startsWith('/api/refdb'));
const manifest = JSON.parse(readFileSync(join(REFDB_SEED_DIR, 'manifest.json'), 'utf8')) as { files: Record<string, { rows: number }> };
const seedLinks = JSON.parse(readFileSync(REFDB_SEED_LINKS, 'utf8')) as { links: Record<string, { refId: string; role: string }[]> };

/** 대응표 연결 Feature 중 ASIL이 대표 행 대표 ASIL과 다르고 asilDeviation 사유도 없는 버전 — 비어 있어야 한다 */
// 2026-11-04 시드 v0.81 기준 31건(Feature 23개)이 있었으나 같은 날 사용자 결정("대표 기준 행 다시 고르기")으로 모두 정리했다 —
// 같은 ASIL의 같은 기능 행이 있으면 대표를 바꾸고, 없으면 대표를 그대로 두고 사유를 기록(tools/refdb/seed-links.ts asilDeviationReason → 시드 doc.asilDeviation).
// 새 불일치(대응표·픽스처·기준 행 대표 ASIL 변경)는 이 목록에 넣지 말고 같은 방식으로 정리한다 — 생기면 실패한다.
const KNOWN_ASIL_MISMATCH: string[] = [];

const METHOD: Record<number, RouteDef['method']> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PUT]: 'PUT', [RequestMethod.PATCH]: 'PATCH', [RequestMethod.DELETE]: 'DELETE' };
const join2 = (a: string, b: string) => ('/' + [a, b].map((s) => s.replace(/^\/|\/$/g, '')).filter(Boolean).join('/')).replace(/\/+/g, '/');

/** 컨트롤러 메서드 → 'METHOD /api/경로'와 그 처리기가 읽는 @Query 이름 */
function handlerQueries(app: INestApplication): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  for (const w of discovery.getControllers()) {
    if (!w.metatype || !w.instance) continue;
    const base = String(reflector.get('path', w.metatype) ?? '');
    const proto = Object.getPrototypeOf(w.instance);
    for (const name of scanner.getAllMethodNames(proto)) {
      const fn = proto[name];
      const path = reflector.get<string | undefined>('path', fn);
      const method = reflector.get<number | undefined>('method', fn);
      if (path === undefined || method === undefined) continue;
      const full = join2('/api', join2(base, path).replace(/^\/api/, ''));
      const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, w.metatype, name) ?? {}) as Record<string, { data?: unknown }>;
      const queries = Object.entries(args)
        .filter(([k]) => Number(k.split(':')[0]) === RouteParamtypes.QUERY)
        .map(([, v]) => v.data)
        .filter((d): d is string => typeof d === 'string');
      out.set(`${METHOD[method]} ${full}`, queries);
    }
  }
  return out;
}

describe('Feature DB 하네스 정합', () => {
  let app: INestApplication;
  let db: Db;
  let repo: RefdbRepository;
  let http: () => any;
  beforeAll(async () => {
    const b = await bootApp();
    ({ app, http } = b);
    db = b.get<Db>(DB);
    repo = b.get(RefdbRepository);
  });
  afterAll(() => app?.close());

  describe('(a) 경로 ↔ 처리기', () => {
    it('Feature DB 경로는 18개 — 모두 D01-01 컴포넌트(발행 미리 보기·변경 요청 감사 이력 W5)', () => {
      expect(REFDB_ROUTES.map((r) => r.name).sort()).toEqual(
        ['createRefChange', 'decideRefChange', 'exportRefdb', 'listRefChanges', 'listRefs', 'publishRefRelease', 'recordSourceReview', 'refChangeDetail', 'refDetail', 'refQuality', 'refReleases', 'refSources', 'refSubfunctions', 'refTaxonomy', 'requestRefAdd', 'reviewRefChange', 'refReleasePreview', 'refChangeAudit'].sort(),
      );
      for (const r of REFDB_ROUTES) expect(r.component, r.name).toBe('D01-01');
    });

    it('경로마다 처리기가 있고, 처리기가 읽는 질의 이름 = routes.ts query(빠짐·남음 없음)', () => {
      const handlers = handlerQueries(app);
      const problems: string[] = [];
      for (const r of REFDB_ROUTES) {
        const key = routeKey(r);
        const q = handlers.get(key);
        if (!q) {
          problems.push(`${r.name} ${key}: 처리기 없음`);
          continue;
        }
        const declared = [...(r.query ?? [])].sort();
        if (JSON.stringify([...q].sort()) !== JSON.stringify(declared)) problems.push(`${r.name}: 처리기 질의 ${[...q].sort().join(',') || '-'} ≠ routes.ts ${declared.join(',') || '-'}`);
      }
      expect(problems).toEqual([]);
    });
  });

  describe('(b) IAM 권한표', () => {
    const refdbWrites = (role: string) => {
      const names = new Set(REFDB_ROUTES.filter((r) => r.method !== 'GET').map((r) => r.name));
      return rolesView().find((v) => v.role === role)!.allowed.filter((n) => names.has(n)).sort();
    };

    it('Feature DB 관리자 — 추가 요청·변경 요청 작성·승인/반려·발행·출처 점검 기록만, 도메인 검토는 없다', () => {
      expect(refdbWrites('REFDB_ADMIN')).toEqual(['createRefChange', 'decideRefChange', 'publishRefRelease', 'recordSourceReview', 'requestRefAdd']);
    });

    it('도메인 검토자 — 변경 요청 작성·도메인 검토만(승인·발행·추가 요청 없음)', () => {
      expect(refdbWrites('DOMAIN_REVIEWER')).toEqual(['createRefChange', 'reviewRefChange']);
    });

    it('DB 관리자의 분류 쓰기4개 외에는 두 역할의 고유 외부 권한이 없다 — 권한표 API도 같은 값을 낸다', async () => {
      const body = (await http().get('/api/iam/roles').expect(200)).body;
      const rows = body.roles as { role: string; allowed: string[] }[];
      const human = rolesView().filter((v) => v.human);
      const common = human.map((v) => v.allowed).reduce((a, b) => a.filter((n) => b.includes(n)));
      for (const role of ['REFDB_ADMIN', 'DOMAIN_REVIEWER']) {
        const view = rolesView().find((v) => v.role === role)!;
        expect(view.human, role).toBe(true);
        const taxonomy=role==='REFDB_ADMIN'?['createTaxonomyNode','updateTaxonomyNode','deleteTaxonomyNode','placeFeatureTaxonomy']:[];
        expect(view.allowed.filter((n) => !REFDB_ROUTES.some((r) => r.name === n) && !common.includes(n)).sort(), `${role}의 Feature DB 밖 고유 권한`).toEqual(taxonomy.sort());
        for(const name of taxonomy){const route=ROUTES.find(route=>route.name===name)!;expect(route.component).toBe('D01-01');expect(route.method).not.toBe('GET');}
        expect(rows.find((r) => r.role === role)?.allowed.sort(), `${role} /api/iam/roles`).toEqual([...view.allowed].sort());
      }
    });
  });

  describe('(c) 직무 분리', () => {
    it('SOD-13(변경 승인)·SOD-14(변경 검토)·SOD-15(검토자 ≠ 승인자)가 규칙표에 있다 — 서버 강제는 refdb-change.spec.ts·refdb-governance.spec.ts(403·감사 DENIED)', () => {
      const ids = SOD_RULES.filter((r) => r.component === 'D01-01').map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining(['SOD-13', 'SOD-14', 'SOD-15']));
    });
  });

  describe('(d) 시드 데이터', () => {
    it('기준 행(feature_ref) 수 = manifest refs 행 수, 딸린 표도 manifest와 같다', () => {
      const n = (t: string) => db.get<{ n: number }>(`SELECT count(*) AS n FROM ${t}`)!.n;
      expect(n('feature_ref')).toBe(manifest.files.refs.rows);
      expect(n('taxonomy_node')).toBe(manifest.files.taxonomy.rows);
      expect(n('ref_source')).toBe(manifest.files.sources.rows);
      expect(n('ref_subfunction')).toBe(manifest.files.subfunctions.rows);
    });

    it('대응표의 refId는 모두 Feature DB에 있고, 연결 색인의 refId도 모두 있다', () => {
      const missing = Object.entries(seedLinks.links).flatMap(([fid, ls]) => ls.filter((l) => !repo.getRef(l.refId)).map((l) => `${fid}:${l.refId}`));
      expect(missing).toEqual([]);
      const dangling = db.all<{ ref_id: string }>('SELECT DISTINCT l.ref_id FROM feature_ref_link l LEFT JOIN feature_ref r ON r.ref_id = l.ref_id WHERE r.ref_id IS NULL');
      expect(dangling).toEqual([]);
    });

    it('연결된 시드 Feature의 ASIL = 대표 행 대표 ASIL, 다르면 asilDeviation 사유(from·to 일치) — 불일치 0건', () => {
      const mismatch: string[] = [];
      for (const [featureId, ls] of Object.entries(seedLinks.links)) {
        const primary = ls.find((l) => l.role === 'PRIMARY')!;
        const ref = repo.getRef(primary.refId)!;
        for (const v of repo.featureVersionDocs(featureId)) {
          const doc = FeatureVersionRow.parse(JSON.parse(v.doc));
          const dev = doc.asilDeviation;
          if (doc.asil === ref.asilRep || (dev?.reason && dev.from === ref.asilRep && dev.to === doc.asil)) continue;
          mismatch.push(`${featureId}@${v.version} asil ${doc.asil} ≠ ${primary.refId} ${ref.asilRep}`);
        }
      }
      if (mismatch.length) console.info(`[refdb-harness] 시드 Feature ASIL ↔ 대표 행 대표 ASIL 불일치 ${mismatch.length}건:\n  ${mismatch.join('\n  ')}`);
      expect(mismatch.sort()).toEqual([...KNOWN_ASIL_MISMATCH].sort());
    });
  });
});
