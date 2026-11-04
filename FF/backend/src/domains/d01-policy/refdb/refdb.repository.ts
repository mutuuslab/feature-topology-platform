// Feature DB 저장소(docs/30-data-model/30-95 §5, 마이그레이션 080·081) — 키 열 + doc(JSON). 서비스는 SQL을 직접 쓰지 않고 이 저장소만 쓴다.
// 담당: 기본 표 읽기·쓰기는 여기(기반 작업), 검색·시드·발행 해시 같은 업무 질의는 읽기 담당(B1)·변경 요청 담당(B3)이 더한다.
import { Inject, Injectable } from '@nestjs/common';
import type { FeatureRefLink, FeatureRefRow, RefChange, RefGlossary, RefRelease, RefSource, RefStatus, RefSubfunction, TaxonomyNode } from '@ff/contracts';
import { compareRelease } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';

const parse = <T>(rows: { doc: string }[]): T[] => rows.map((r) => JSON.parse(r.doc) as T);
/** 값이 있는 조건만 WHERE로 — 열 이름은 이 파일의 고정 문자열만 들어온다 */
function whereOf(conds: Record<string, string | undefined>): { sql: string; params: string[] } {
  const used = Object.entries(conds).filter((e): e is [string, string] => !!e[1]);
  return { sql: used.length ? ` WHERE ${used.map(([c]) => `${c} = ?`).join(' AND ')}` : '', params: used.map(([, v]) => v) };
}

/** meta 키 — Feature DB 첫 기동 가져오기 기록(JSON) */
export const SEED_META_KEY = 'seed-refdb';

export interface RefFilter {
  domain?: string;
  component?: string;
  status?: RefStatus;
}

export interface RefLinkRow extends FeatureRefLink {
  featureId: string;
  version: string;
}

@Injectable()
export class RefdbRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ── 기준 행 ──
  getRef(refId: string): FeatureRefRow | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM feature_ref WHERE ref_id = ?', refId);
    return r ? (JSON.parse(r.doc) as FeatureRefRow) : undefined;
  }
  /** 키 열(도메인·컴포넌트·상태)로 거른 기준 행 — ID 순 */
  listRefs(f: RefFilter = {}): FeatureRefRow[] {
    const w = whereOf({ domain: f.domain, component: f.component, status: f.status });
    return parse<FeatureRefRow>(this.db.all(`SELECT doc FROM feature_ref${w.sql} ORDER BY ref_id`, ...w.params));
  }
  statusOf(refId: string): RefStatus | undefined {
    return this.db.get<{ status: RefStatus }>('SELECT status FROM feature_ref WHERE ref_id = ?', refId)?.status;
  }
  countRefs(): number {
    return Number(this.db.get<{ n: number | string }>('SELECT count(*) AS n FROM feature_ref')!.n);
  }
  /** 지금까지 쓴 모든 기준 행 ID — 기준 행(폐기 포함)과 변경 요청 대상(반려된 추가 요청 포함). 새 ID는 이것과 겹치지 않는다 */
  usedRefIds(): string[] {
    return this.db.all<{ id: string }>('SELECT ref_id AS id FROM feature_ref UNION SELECT ref_id AS id FROM ref_change').map((r) => r.id);
  }
  insertRef(row: FeatureRefRow, at: string) {
    this.db.run('INSERT INTO feature_ref (ref_id, status, domain, component, name_ko, doc, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', row.refId, row.status, row.domain, row.component, row.nameKo, JSON.stringify(row), at);
  }
  /** 기준 행 갱신 — 행은 지우지 않는다(폐기는 상태 RETIRED) */
  updateRef(row: FeatureRefRow, at: string) {
    this.db.run('UPDATE feature_ref SET status = ?, domain = ?, component = ?, name_ko = ?, doc = ?, updated_at = ? WHERE ref_id = ?', row.status, row.domain, row.component, row.nameKo, JSON.stringify(row), at, row.refId);
  }

  // ── 분류·출처·용어집·세부기능 후보 ──
  taxonomy(): TaxonomyNode[] {
    return parse<TaxonomyNode>(this.db.all('SELECT doc FROM taxonomy_node ORDER BY node_id'));
  }
  insertTaxonomy(n: TaxonomyNode) {
    this.db.run('INSERT INTO taxonomy_node (node_id, level, parent_id, abbr, status, doc) VALUES (?, ?, ?, ?, ?, ?)', n.nodeId, n.level, n.parentId, n.abbr, n.status, JSON.stringify(n));
  }
  sources(): RefSource[] {
    return parse<RefSource>(this.db.all('SELECT doc FROM ref_source ORDER BY source_id'));
  }
  insertSource(s: RefSource) {
    this.db.run('INSERT INTO ref_source (source_id, next_review_at, doc) VALUES (?, ?, ?)', s.sourceId, s.nextReviewAt, JSON.stringify(s));
  }
  /** 출처 정기 점검 기록 — 다음 점검일 열과 doc을 함께 바꾼다 */
  updateSource(s: RefSource) {
    this.db.run('UPDATE ref_source SET next_review_at = ?, doc = ? WHERE source_id = ?', s.nextReviewAt, JSON.stringify(s), s.sourceId);
  }
  glossary(): RefGlossary[] {
    return parse<RefGlossary>(this.db.all('SELECT doc FROM ref_glossary ORDER BY term'));
  }
  insertGlossary(g: RefGlossary) {
    this.db.run('INSERT INTO ref_glossary (term, doc) VALUES (?, ?)', g.term, JSON.stringify(g));
  }
  subfunctions(component?: string): RefSubfunction[] {
    return component
      ? parse<RefSubfunction>(this.db.all('SELECT doc FROM ref_subfunction WHERE component = ? ORDER BY id', component))
      : parse<RefSubfunction>(this.db.all('SELECT doc FROM ref_subfunction ORDER BY id'));
  }
  insertSubfunction(s: RefSubfunction) {
    this.db.run('INSERT INTO ref_subfunction (component, name, doc) VALUES (?, ?, ?)', s.component, s.name, JSON.stringify(s));
  }

  // ── 발행 버전(추가만) ──
  releases(): RefRelease[] {
    return parse<RefRelease>(this.db.all('SELECT doc FROM ref_release')).sort((a, b) => compareRelease(a.release, b.release));
  }
  latestRelease(): RefRelease | undefined {
    return this.releases().at(-1);
  }
  insertRelease(r: RefRelease) {
    this.db.run('INSERT INTO ref_release (release_id, published_by, published_at, hash, doc) VALUES (?, ?, ?, ?, ?)', r.release, r.publishedBy, r.publishedAt, r.hash, JSON.stringify(r));
  }

  // ── 변경 요청 ──
  changes(f: { status?: string; kind?: string; refId?: string } = {}): RefChange[] {
    const w = whereOf({ status: f.status, kind: f.kind, ref_id: f.refId });
    return parse<RefChange>(this.db.all(`SELECT doc FROM ref_change${w.sql} ORDER BY created_at DESC, change_id DESC`, ...w.params));
  }
  getChange(changeId: string): RefChange | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ref_change WHERE change_id = ?', changeId);
    return r ? (JSON.parse(r.doc) as RefChange) : undefined;
  }
  insertChange(c: RefChange) {
    this.db.run('INSERT INTO ref_change (change_id, kind, ref_id, status, doc, requested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', c.changeId, c.kind, c.refId, c.status, JSON.stringify(c), c.requestedBy, c.requestedAt);
  }
  updateChange(c: RefChange) {
    this.db.run('UPDATE ref_change SET status = ?, doc = ? WHERE change_id = ?', c.status, JSON.stringify(c), c.changeId);
  }
  /** 다음 변경 요청 번호 — CR-연도-일련번호(연도마다 001부터) */
  nextChangeId(year: number): string {
    const prefix = `CR-${year}-`;
    const r = this.db.get<{ m: number | null }>('SELECT max(CAST(substr(change_id, 9) AS INTEGER)) AS m FROM ref_change WHERE change_id LIKE ?', `${prefix}%`);
    return `${prefix}${String((r?.m ?? 0) + 1).padStart(3, '0')}`;
  }

  // ── Feature 버전 ↔ 기준 행 연결 색인 ──
  /** 한 Feature 버전의 연결을 통째로 바꾼다 — feature_version 저장과 같은 트랜잭션에서 부른다 */
  replaceLinks(featureId: string, version: string, links: readonly FeatureRefLink[]) {
    this.db.run('DELETE FROM feature_ref_link WHERE feature_id = ? AND version = ?', featureId, version);
    for (const l of links) this.db.run('INSERT INTO feature_ref_link (feature_id, version, ref_id, role, ref_version) VALUES (?, ?, ?, ?, ?)', featureId, version, l.refId, l.role, l.refVersion);
  }
  linksOf(featureId: string, version: string): FeatureRefLink[] {
    return this.db
      .all<{ ref_id: string; role: FeatureRefLink['role']; ref_version: string }>('SELECT ref_id, role, ref_version FROM feature_ref_link WHERE feature_id = ? AND version = ? ORDER BY role DESC, ref_id', featureId, version)
      .map((r) => ({ refId: r.ref_id, role: r.role, refVersion: r.ref_version }));
  }
  /** 연결이 하나도 없는 Feature 버전 — 시드 대응표에 없던 것·연결 도입 전 행('확인 필요' 목록) */
  unlinkedFeatureVersions(): { featureId: string; version: string; lifecycle: string; doc: string }[] {
    return this.db
      .all<{ feature_id: string; version: string; lifecycle: string; doc: string }>(
        'SELECT f.feature_id, f.version, f.lifecycle, f.doc FROM feature_version f WHERE NOT EXISTS (SELECT 1 FROM feature_ref_link l WHERE l.feature_id = f.feature_id AND l.version = f.version) ORDER BY f.feature_id, f.version',
      )
      .map((r) => ({ featureId: r.feature_id, version: r.version, lifecycle: r.lifecycle, doc: r.doc }));
  }
  /** 이 기준 행을 쓰는 Feature 버전 + 그 버전의 이름·수명주기·범위(상세 화면) — 연결 색인만 있고 버전이 없으면 이름은 null */
  linkedFeatures(refId: string): (RefLinkRow & { lifecycle: string | null; doc: string | null })[] {
    return this.db
      .all<{ feature_id: string; version: string; ref_id: string; role: FeatureRefLink['role']; ref_version: string; lifecycle: string | null; doc: string | null }>(
        'SELECT l.feature_id, l.version, l.ref_id, l.role, l.ref_version, f.lifecycle, f.doc FROM feature_ref_link l LEFT JOIN feature_version f ON f.feature_id = l.feature_id AND f.version = l.version WHERE l.ref_id = ? ORDER BY l.feature_id, l.version',
        refId,
      )
      .map((r) => ({ featureId: r.feature_id, version: r.version, refId: r.ref_id, role: r.role, refVersion: r.ref_version, lifecycle: r.lifecycle, doc: r.doc }));
  }

  // ── 시드(30-95 §9) — 첫 기동 가져오기만 쓴다 ──
  /** 시드 Feature 버전의 doc — 대응표 연결을 붙일 대상 */
  featureVersionDocs(featureId: string): { version: string; doc: string }[] {
    return this.db.all<{ version: string; doc: string }>('SELECT version, doc FROM feature_version WHERE feature_id = ? ORDER BY version', featureId);
  }
  /** 시드 Feature 버전 doc 갱신(featureRefs·_missing만 바꾼 doc) — 연결 색인 replaceLinks와 같은 트랜잭션에서 */
  setFeatureVersionDoc(featureId: string, version: string, doc: unknown) {
    this.db.run('UPDATE feature_version SET doc = ? WHERE feature_id = ? AND version = ?', JSON.stringify(doc), featureId, version);
  }
  /** 가져오기 기록(meta) — 대응표에 없던 시드 Feature('확인 필요') 사유·후보를 함께 둔다 */
  seedRecord(): string | undefined {
    return this.db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', SEED_META_KEY)?.value;
  }
  putSeedRecord(value: string) {
    this.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', SEED_META_KEY, value);
  }
  /** 컴포넌트별 세부기능 후보 수(검색 결과 배지) */
  subfunctionCounts(): Map<string, number> {
    return new Map(this.db.all<{ component: string; n: number | string }>('SELECT component, count(*) AS n FROM ref_subfunction GROUP BY component').map((r) => [r.component, Number(r.n)]));
  }
  countReleases(): number {
    return Number(this.db.get<{ n: number | string }>('SELECT count(*) AS n FROM ref_release')!.n);
  }

  /** 이 기준 행을 쓰는 Feature 버전(영향 분석 §8.3) */
  usersOf(refId: string): RefLinkRow[] {
    return this.db
      .all<{ feature_id: string; version: string; ref_id: string; role: FeatureRefLink['role']; ref_version: string }>('SELECT feature_id, version, ref_id, role, ref_version FROM feature_ref_link WHERE ref_id = ? ORDER BY feature_id, version', refId)
      .map((r) => ({ featureId: r.feature_id, version: r.version, refId: r.ref_id, role: r.role, refVersion: r.ref_version }));
  }

  /** 기준 행 → 이 행을 연결한 Registry Feature 이름(중복 없이) — 검색이 Feature 이름으로도 찾는다(P1-8) */
  linkedFeatureNames(): Map<string, string[]> {
    const out = new Map<string, Set<string>>();
    for (const r of this.db.all<{ ref_id: string; doc: string | null }>('SELECT l.ref_id, f.doc FROM feature_ref_link l JOIN feature_version f ON f.feature_id = l.feature_id AND f.version = l.version')) {
      const name = r.doc ? (JSON.parse(r.doc) as { name?: string }).name : undefined;
      if (!name) continue;
      if (!out.has(r.ref_id)) out.set(r.ref_id, new Set());
      out.get(r.ref_id)!.add(name);
    }
    return new Map([...out].map(([k, v]) => [k, [...v]]));
  }

  /** Feature 버전의 Owner·이름(발행 미리 보기 — 알림 받을 사람) */
  featureOwner(featureId: string, version: string): { name: string | null; ownerId: string | null } {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM feature_version WHERE feature_id = ? AND version = ?', featureId, version);
    const d = r ? (JSON.parse(r.doc) as { name?: string; ownerId?: string }) : {};
    return { name: d.name ?? null, ownerId: d.ownerId ?? null };
  }
}
