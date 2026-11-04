// Feature DB 첫 기동 시드(30-95 §9) — 빈 Feature DB에만 data/reference/feature-db/v1.3/*.json을 'v1.3 (엑셀 가져옴)' 발행으로 넣는다.
// 이미 원천이 FF인 설치(기준 행·발행 이력이 있는 DB)에는 다시 쓰지 않는다 — 이후 변경은 변경 요청으로만(D-REF-5·8).
// 데모 시드와 무관하다: 고객 설치(FF_SEED=none)도 빈 Feature DB면 v1.3을 받는다 — 첫 Feature 등록부터 실제 기준 행을 고른다.
// FF_REFDB_SEED=off면 넣지 않는다(빈 Feature DB로 시작 — 고객이 자기 기준 데이터를 따로 옮길 때).
// 시드 Feature 연결(seed-links.json)은 데모 Feature가 들어갈 때(FF_SEED≠none, 기본 픽스처)만 붙인다.
// 시드 Feature 68개의 연결은 seed-links.json 대응표로 채운다 — 대응이 없는 8개(_missing)는 연결을 지어내지 않고
// doc._missing.featureRefs='미입력' + 가져오기 기록(meta)에 사유·후보를 남겨 화면이 '확인 필요'로 보여 준다(품질 지표 needsLink).
// 시드 ASIL이 대표 행 대표 ASIL과 다른 Feature는 대응표의 asilDeviation(from·to·사유)을 그 ASIL 버전 doc.asilDeviation으로 넣는다(30-95 §6.3).
// 확정 버전 doc까지 바꾸므로 가져오기 한 번을 감사 REFDB_SEED 한 건(행 수·바꾼 Feature 버전 목록)으로 남긴다.
// 가져오기 자료가 없으면(NO_DATA) 빈 Feature DB로 뜬다 — 운영 모드에서는 오류 로그(패키지에 data/reference가 빠진 것), 준비 점검(health/ready refdb)이 503.
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AsilDeviation, FeatureRefLinks, FeatureRefRow, RefGlossary, RefRelease, RefSource, RefSubfunction, TaxonomyNode, type FeatureRefLink } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { DB, type Db } from '../../../kernel/db';
import { isProduction, seedOf } from '../../../kernel/runtime-config';
import { RefdbRepository } from './refdb.repository';

/** 커밋된 가져오기 결과(tools/refdb/import.ts) — repo 루트 기준 */
const FEATURE_DB_ROOT = join(__dirname, '..', '..', '..', '..', '..', 'data', 'reference', 'feature-db');
export const REFDB_SEED_DIR = join(FEATURE_DB_ROOT, 'v1.3');
export const REFDB_SEED_LINKS = join(FEATURE_DB_ROOT, 'seed-links.json');
export const SEED_RELEASE = 'v1.3';
/** 발행 기록의 발행자 — 사람이 아닌 첫 기동 가져오기 */
export const SEED_PUBLISHER = 'system:refdb-seed';
/** 가져오기 감사의 행위자 */
const SEED_ACTOR: Actor = { id: SEED_PUBLISHER, role: 'SYSTEM', correlationId: '' };

/** 가져오기 manifest(tools/refdb/import-lib renderFiles) — 쓰는 값만 */
const Manifest = z.object({
  release: z.string(),
  source: z.object({ file: z.string(), sha256: z.string() }),
  files: z.record(z.string(), z.object({ rows: z.number().int(), sha256: z.string() })),
});

/** 대응표에 없던 시드 Feature 한 건 — 사유(featureRefs)와 후보 기준 행 */
const MissingLink = z.object({ name: z.string(), featureRefs: z.string(), candidates: z.array(z.string()).default([]) });
const SeedLinks = z.object({
  refVersion: z.string(),
  links: z.record(z.string(), FeatureRefLinks),
  /** 같은 ASIL의 같은 기능 행이 없어 대표를 그대로 둔 Feature의 ASIL 사유 — featureId별 */
  asilDeviation: z.record(z.string(), AsilDeviation).default({}),
  _missing: z.record(z.string(), MissingLink).default({}),
});

/** 가져오기 기록(meta seed-refdb) — 다시 가져오지 않는 표시이자 '확인 필요' 목록의 사유 원천 */
export const SeedRecord = z.object({
  release: z.string(),
  hash: z.string(),
  at: z.string(),
  refs: z.number().int(),
  linkedVersions: z.number().int(),
  missing: z.array(MissingLink.extend({ featureId: z.string() })),
});
export type SeedRecord = z.infer<typeof SeedRecord>;
export type SeedMissingLink = SeedRecord['missing'][number];

export interface RefdbSeedResult {
  seeded: boolean;
  /** 건너뛴 이유 — 이미 Feature DB가 있음 · 가져오기 결과 파일 없음 */
  skipped?: 'NOT_EMPTY' | 'NO_DATA';
  counts?: { refs: number; taxonomy: number; sources: number; glossary: number; subfunctions: number; linkedVersions: number; missing: number };
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

function loadFiles(dir: string) {
  const manifestText = readFileSync(join(dir, 'manifest.json'), 'utf8');
  const manifest = Manifest.parse(JSON.parse(manifestText));
  const rows = <T>(name: string, schema: z.ZodType<T>): T[] => {
    const out = z.array(schema).parse(readJson(join(dir, `${name}.json`)));
    const want = manifest.files[name]?.rows;
    if (want !== out.length) throw new Error(`Feature DB ${name}.json 행 수(${out.length})가 manifest(${want ?? '없음'})와 다릅니다`);
    return out;
  };
  return {
    manifest,
    /** 발행 해시 — manifest.json(원본 xlsx·파일별 SHA-256·행 수) 원문의 SHA-256 */
    hash: createHash('sha256').update(manifestText).digest('hex'),
    refs: rows('refs', FeatureRefRow.strict()),
    // 딸린 표는 가져오기가 남긴 추가 열(세부기능 ID·그룹·검증 초점, 컴포넌트 약어 목록 …)을 그대로 둔다
    taxonomy: rows('taxonomy', TaxonomyNode.passthrough()),
    sources: rows('sources', RefSource.passthrough()),
    glossary: rows('glossary', RefGlossary.passthrough()),
    subfunctions: rows('subfunctions', RefSubfunction.passthrough()),
  };
}
/** 한 프로세스에서 한 번만 읽고 검증한다(시험은 부팅마다 시드한다 — 2 MB JSON을 매번 다시 읽지 않게) */
const cache = new Map<string, ReturnType<typeof loadFiles>>();
const filesOf = (dir: string) => {
  let v = cache.get(dir);
  if (!v) cache.set(dir, (v = loadFiles(dir)));
  return v;
};

/** FF_REFDB_SEED=off(또는 0·false)면 첫 기동 가져오기를 건너뛴다 — 기본은 켬 */
export const refdbSeedEnabled = (env: Record<string, string | undefined> = process.env) => !/^(off|0|false)$/i.test((env.FF_REFDB_SEED ?? '').trim());

type Doc = Record<string, unknown>;
const linked = (doc: Doc) => Array.isArray(doc.featureRefs) && doc.featureRefs.length > 0;

/**
 * 빈 Feature DB에 v1.3을 넣고 시드 Feature에 연결을 붙인다 — 한 트랜잭션.
 * linksPath가 null이면 연결은 붙이지 않는다(기본 픽스처가 아닌 설치).
 */
export function seedRefdb(db: Db, repo: RefdbRepository, opts: { at: string; dir?: string; linksPath?: string | null; audit?: AuditService }): RefdbSeedResult {
  if (repo.countRefs() > 0 || repo.countReleases() > 0 || repo.seedRecord()) return { seeded: false, skipped: 'NOT_EMPTY' };
  const dir = opts.dir ?? REFDB_SEED_DIR;
  if (!existsSync(join(dir, 'manifest.json'))) return { seeded: false, skipped: 'NO_DATA' };
  const f = filesOf(dir);
  const links = opts.linksPath && existsSync(opts.linksPath) ? SeedLinks.parse(readJson(opts.linksPath)) : null;
  const known = new Map(f.refs.map((r) => [r.refId, r]));
  let linkedVersions = 0;
  const missing: SeedMissingLink[] = [];
  /** 이 가져오기가 doc을 바꾼 Feature 버전(featureId@version) — 감사에 남긴다 */
  const touched: { linked: string[]; missing: string[] } = { linked: [], missing: [] };
  db.tx(() => {
    for (const n of f.taxonomy) repo.insertTaxonomy(n); // 노드 ID는 수준마다 다른 구분자라 겹치지 않는다(refdb:check가 지킨다)
    for (const r of f.refs) repo.insertRef(r, opts.at);
    for (const s of f.sources) repo.insertSource(s);
    for (const g of f.glossary) repo.insertGlossary(g);
    for (const s of f.subfunctions) repo.insertSubfunction(s);
    repo.insertRelease(
      RefRelease.parse({ release: SEED_RELEASE, publishedBy: SEED_PUBLISHER, publishedAt: opts.at, changeIds: [], hash: f.hash, note: `${SEED_RELEASE} (엑셀 가져옴) — ${f.manifest.source.file} SHA-256 ${f.manifest.source.sha256}` }),
    );
    if (links) {
      for (const [featureId, ls] of Object.entries(links.links)) {
        const stored: FeatureRefLink[] = ls.map((l) => ({ refId: l.refId, role: l.role, refVersion: l.refVersion }));
        const unknown = stored.filter((l) => !known.has(l.refId));
        if (unknown.length) throw new Error(`seed-links.json ${featureId}: Feature DB에 없는 기준 행 ${unknown.map((l) => l.refId).join(', ')}`);
        const dev = links.asilDeviation[featureId];
        const primary = known.get(stored.find((l) => l.role === 'PRIMARY')?.refId ?? '');
        if (dev && dev.from !== primary?.asilRep) throw new Error(`seed-links.json ${featureId}: ASIL 사유 from ${dev.from} ≠ 대표 행 ${primary?.refId} 대표 ASIL ${primary?.asilRep}`);
        for (const v of repo.featureVersionDocs(featureId)) {
          const doc = JSON.parse(v.doc) as Doc;
          if (linked(doc)) continue; // 이미 연결된 버전은 그대로
          // 사유는 그 ASIL 버전에만 — 대표 ASIL과 같은 버전에 남기면 G2에 거짓 검토 표시가 뜬다
          const deviation = dev && doc.asil === dev.to && !doc.asilDeviation ? { asilDeviation: dev } : {};
          repo.setFeatureVersionDoc(featureId, v.version, { ...doc, featureRefs: stored, ...deviation });
          repo.replaceLinks(featureId, v.version, stored);
          linkedVersions++;
          touched.linked.push(`${featureId}@${v.version}`);
        }
      }
      for (const [featureId, m] of Object.entries(links._missing)) {
        const versions = repo.featureVersionDocs(featureId);
        if (!versions.length) continue;
        missing.push({ featureId, ...m });
        // 연결을 지어내지 않는다 — 자리표시 관례(_missing)로 '미입력'만 표시하고 사유·후보는 가져오기 기록에
        for (const v of versions) {
          const doc = JSON.parse(v.doc) as Doc;
          if (linked(doc)) continue;
          repo.setFeatureVersionDoc(featureId, v.version, { ...doc, _missing: { ...((doc._missing as Doc | undefined) ?? {}), featureRefs: '미입력' } });
          touched.missing.push(`${featureId}@${v.version}`);
        }
      }
    }
    const record: SeedRecord = { release: SEED_RELEASE, hash: f.hash, at: opts.at, refs: f.refs.length, linkedVersions, missing };
    repo.putSeedRecord(JSON.stringify(record));
    opts.audit?.record(SEED_ACTOR, 'REFDB_SEED', SEED_RELEASE, {
      after: {
        release: SEED_RELEASE,
        hash: f.hash,
        counts: { refs: f.refs.length, taxonomy: f.taxonomy.length, sources: f.sources.length, glossary: f.glossary.length, subfunctions: f.subfunctions.length },
        linkedVersions: touched.linked,
        missingVersions: touched.missing,
      },
      reason: `Feature DB ${SEED_RELEASE} 첫 기동 가져오기 — ${f.manifest.source.file}`,
      componentId: 'D01-01',
    });
  });
  return {
    seeded: true,
    counts: { refs: f.refs.length, taxonomy: f.taxonomy.length, sources: f.sources.length, glossary: f.glossary.length, subfunctions: f.subfunctions.length, linkedVersions, missing: missing.length },
  };
}

/** 가져오기 기록 — 없거나 읽을 수 없으면 null */
export function readSeedRecord(repo: RefdbRepository): SeedRecord | null {
  const raw = repo.seedRecord();
  if (!raw) return null;
  try {
    const p = SeedRecord.safeParse(JSON.parse(raw));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

@Injectable()
export class RefdbSeed implements OnModuleInit {
  private readonly log = new Logger('RefdbSeed');
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: RefdbRepository,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** 빈 Feature DB면 어떤 시드에서도 v1.3을 넣는다. 대응표는 데모 Feature(기본 픽스처 v0.81)가 있을 때만 — 다른 픽스처의 같은 Feature ID에 엉뚱한 연결을 붙이지 않게 */
  onModuleInit() {
    if (!refdbSeedEnabled(process.env)) return;
    // TODO(통합): kernel/db-open.ts applySeed에서 부르면 시험 PG 틀 데이터베이스에 함께 담겨 복제 부팅마다 다시 넣지 않는다
    const demoFeatures = seedOf(process.env) !== 'none' && !process.env.FF_FIXTURES;
    const r = this.run({ linksPath: demoFeatures ? REFDB_SEED_LINKS : null });
    if (r.seeded && r.counts?.missing) this.log.warn(`Feature DB ${SEED_RELEASE} 가져옴 — 대응표에 없는 시드 Feature ${r.counts.missing}개는 기준 행 연결 '확인 필요'`);
  }

  /** 가져오기 + 감사. NO_DATA(가져오기 자료 없음)는 운영 모드에서 오류 로그 — 빈 Feature DB로는 Feature를 등록할 수 없다 */
  run(opts: { dir?: string; linksPath?: string | null } = {}): RefdbSeedResult {
    const r = seedRefdb(this.db, this.repo, { at: this.clock.iso(), audit: this.audit, ...opts });
    if (r.skipped === 'NO_DATA') {
      const msg = `Feature DB 가져오기 자료가 없습니다(${join(opts.dir ?? REFDB_SEED_DIR, 'manifest.json')}) — 빈 Feature DB로 시작합니다. 패키지에 data/reference/feature-db가 들어 있는지 확인하세요(끄려면 FF_REFDB_SEED=off).`;
      if (isProduction(process.env)) this.log.error(msg);
      else this.log.warn(msg);
    }
    return r;
  }
}
