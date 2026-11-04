// Feature DB (D01-01, 설계 docs/30-data-model/30-95) — 차종과 무관한 기능 정의·규모·근거 기준 행.
// Feature 등록은 기준 행을 대표 1 + 포함 N으로 참조한다(D-REF-2·3). 없는 기능은 요청 중(PENDING) 행으로 바로 만든다(D-REF-7).
// 금액 필드(벤치마크 €)는 산정 역할만 본다(20-94 §8) — 산정 모듈 전이라 공개 응답에서 항상 뺀다.
import { Body, Controller, Get, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import {
  FEATURE_REF_STATUSES,
  FeatureRefRequestBody,
  FeatureRefRow,
  nextRefId,
  refQuality,
  refSearchScore,
  type FeatureRefLink,
  type FeatureRefPublic,
  type FeatureRefStatus,
  type RefGlossaryRow,
  type RefSourceRow,
  type RefSubfunctionRow,
  type TaxonomyNodeRow,
} from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { ZodPipe } from '../../../kernel/zod.pipe';

export type FeatureRefSummary = Pick<FeatureRefRow, 'refId' | 'status' | 'replacedBy' | 'domain' | 'cluster' | 'component' | 'swStack' | 'nameEn' | 'nameKo' | 'aliases' | 'lifecycle' | 'asilRep' | 'tshirt'> & { summary: string | null };

const publicOf = ({ benchmarkEur: _hidden, ...rest }: FeatureRefRow): FeatureRefPublic => rest;
const summaryOf = (r: FeatureRefRow): FeatureRefSummary => ({
  refId: r.refId,
  status: r.status,
  replacedBy: r.replacedBy,
  domain: r.domain,
  cluster: r.cluster,
  component: r.component,
  swStack: r.swStack,
  nameEn: r.nameEn,
  nameKo: r.nameKo,
  aliases: r.aliases,
  lifecycle: r.lifecycle,
  asilRep: r.asilRep,
  tshirt: r.tshirt,
  summary: r.definition?.summary ?? null,
});

const MAX_LIMIT = 200;

@Injectable()
@PlatformComponent('D01-01')
export class RefdbService {
  /** 기준 행 읽기 캐시 — 행 수·마지막 수정 시각이 같으면 다시 풀지 않는다(검색은 입력마다 온다) */
  private cache: { key: string; rows: FeatureRefRow[]; byId: Map<string, FeatureRefRow> } | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  private rows(): { rows: FeatureRefRow[]; byId: Map<string, FeatureRefRow> } {
    const k = this.db.get<{ n: number; m: string | null }>('SELECT count(*) AS n, max(updated_at) AS m FROM feature_ref');
    const key = `${k?.n ?? 0}|${k?.m ?? ''}`;
    if (this.cache?.key === key) return this.cache;
    const rows = this.db.all<{ doc: string }>('SELECT doc FROM feature_ref ORDER BY ref_id').map((r) => JSON.parse(r.doc) as FeatureRefRow);
    const next = { key, rows, byId: new Map(rows.map((r) => [r.refId, r])) };
    if (!this.db.inTransaction) this.cache = next;
    return next;
  }

  /** 등록·전이 점검용 — 금액 필드 포함 원본(서버 안에서만) */
  lookup(refId: string): FeatureRefRow | undefined {
    return this.rows().byId.get(refId);
  }

  search(q: { q?: string; domain?: string; component?: string; status?: string; limit?: number; offset?: number }) {
    const statuses = q.status ? q.status.split(',').filter(Boolean) : undefined;
    for (const s of statuses ?? []) if (!(FEATURE_REF_STATUSES as readonly string[]).includes(s)) throw new DomainError('VALIDATION', `상태는 ${FEATURE_REF_STATUSES.join('·')} 중 하나입니다.`, { status: s });
    const limit = Math.min(Math.max(1, q.limit ?? 50), MAX_LIMIT);
    const offset = Math.max(0, q.offset ?? 0);
    const scored = this.rows()
      .rows.filter((r) => (!q.domain || r.domain === q.domain) && (!q.component || r.component === q.component) && (!statuses || statuses.includes(r.status)))
      .map((r) => ({ r, score: refSearchScore(r, q.q ?? '') }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (a.r.refId < b.r.refId ? -1 : 1));
    return { items: scored.slice(offset, offset + limit).map((x) => summaryOf(x.r)), total: scored.length, offset, limit };
  }

  detail(refId: string) {
    const r = this.lookup(refId);
    if (!r) throw new DomainError('NOT_FOUND', `Feature DB에 ${refId} 기준 행이 없습니다.`);
    const sources = r.sourceIds.length
      ? this.db.all<{ doc: string }>(`SELECT doc FROM ref_source WHERE source_id IN (${r.sourceIds.map(() => '?').join(',')})`, ...r.sourceIds).map((x) => JSON.parse(x.doc) as RefSourceRow)
      : [];
    const subfunctions = this.db.all<{ doc: string }>('SELECT doc FROM ref_subfunction WHERE component = ? ORDER BY candidate_id', r.component).map((x) => JSON.parse(x.doc) as RefSubfunctionRow);
    const glossary = this.db.all<{ doc: string }>('SELECT doc FROM ref_glossary').map((x) => JSON.parse(x.doc) as RefGlossaryRow).filter((g) => g.refIds.includes(refId));
    const usedBy = this.db.all<{ feature_id: string; version: string; role: string }>('SELECT feature_id, version, role FROM feature_ref_link WHERE ref_id = ? ORDER BY feature_id, version', refId);
    return { ref: publicOf(r), sources, subfunctions, glossary, usedBy: usedBy.map((u) => ({ featureId: u.feature_id, version: u.version, role: u.role })) };
  }

  taxonomy(): TaxonomyNodeRow[] {
    return this.db.all<{ node_id: string; level: TaxonomyNodeRow['level']; parent_id: string | null; name: string; abbr: string | null }>('SELECT * FROM taxonomy_node ORDER BY level, name').map((t) => ({ nodeId: t.node_id, level: t.level, parentId: t.parent_id, name: t.name, abbr: t.abbr }));
  }

  /** 지금 발행 버전 — 연결 때 Feature에 함께 남긴다 */
  latestRelease(): string | null {
    return this.db.get<{ release: string }>('SELECT release FROM ref_release ORDER BY published_at DESC, release DESC LIMIT 1')?.release ?? null;
  }

  overview() {
    const { rows } = this.rows();
    const releases = this.db.all<{ release: string; published_at: string; published_by: string; note: string }>('SELECT release, published_at, published_by, note FROM ref_release ORDER BY published_at DESC');
    return {
      release: releases[0]?.release ?? null,
      releases: releases.map((r) => ({ release: r.release, publishedAt: r.published_at, publishedBy: r.published_by, note: r.note })),
      quality: refQuality(rows, this.clock.iso().slice(0, 10)),
      domains: [...new Set(rows.map((r) => r.domain))].sort(),
      pendingRequests: (this.db.get<{ n: number }>("SELECT count(*) AS n FROM ref_change WHERE status = 'OPEN'")?.n ?? 0),
    };
  }

  /** 추가 요청(D-REF-7) — 정식 형식 ID를 즉시 부여하고 PENDING 행 + 변경 요청을 한 tx로 만든다. ID는 바꿔 쓰지 않는다 */
  request(actor: Actor, body: FeatureRefRequestBody): FeatureRefPublic {
    const tax = this.taxonomy();
    const domain = tax.find((t) => t.level === 'DOMAIN' && t.name === body.domain);
    if (!domain) throw new DomainError('VALIDATION', `Feature DB 도메인 '${body.domain}'이(가) 없습니다.`, { domain: body.domain });
    const component = tax.find((t) => t.level === 'COMPONENT' && t.name === body.component && tax.find((c) => c.nodeId === t.parentId)?.parentId === domain.nodeId);
    if (!component?.abbr) throw new DomainError('VALIDATION', `컴포넌트 '${body.component}'이(가) ${body.domain} 아래에 없습니다. 새 컴포넌트는 Feature DB 관리자가 분류를 먼저 추가합니다.`, { component: body.component });
    const at = this.clock.iso();
    return this.db.tx(() => {
      const ids = this.db.all<{ ref_id: string }>('SELECT ref_id FROM feature_ref').map((r) => r.ref_id);
      const refId = nextRefId(ids, domain.abbr!, component.abbr!);
      const row = FeatureRefRow.parse({
        refId,
        status: 'PENDING' satisfies FeatureRefStatus,
        replacedBy: null,
        registeredIn: null,
        evidenceCheckedAt: null,
        domain: body.domain,
        cluster: tax.find((c) => c.nodeId === component.parentId)!.name,
        component: body.component,
        swStack: body.swStack,
        nameEn: body.nameEn,
        nameKo: body.nameKo,
        aliases: [],
        lifecycle: 'Commodity',
        techStack: null,
        autoQuality: 'High',
        techQuality: null,
        asilRep: body.asilRep,
        method: null,
        tshirt: body.tshirt,
        bundleId: null,
        bundleRep: false,
        sizeEvidenceGrade: 'D',
        benchmarkEur: null,
        kearneyNote: null,
        makeBuyVolume: null,
        makeBuyPremium: null,
        relevance: null,
        sourceIds: [],
        sourceDetail: null,
        remark: body.evidence,
        basisType: null,
        vehicleType: null,
        region: null,
        duplicateOf: null,
        requires: [],
        excludes: [],
        procurement: null,
        swPackage: null,
        licenseItem: null,
        billing: null,
        adminMemo: null,
        definition: null,
      });
      const changeId = `RCR-${String((this.db.get<{ n: number }>('SELECT count(*) AS n FROM ref_change')?.n ?? 0) + 1).padStart(5, '0')}`;
      this.db.run('INSERT INTO feature_ref (ref_id, status, domain, component, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', refId, row.status, row.domain, row.component, JSON.stringify(row), at, at);
      this.db.run("INSERT INTO ref_change (change_id, kind, ref_id, status, requested_by, requested_at, doc) VALUES (?, 'ADD', ?, 'OPEN', ?, ?, ?)", changeId, refId, actor.id, at, JSON.stringify({ after: row, evidence: body.evidence }));
      this.audit.record(actor, 'FEATURE_REF_REQUEST', refId, { after: publicOf(row), reason: body.evidence, componentId: 'D01-01' });
      return publicOf(row);
    });
  }

  /** Feature 버전의 연결 색인을 다시 쓴다 — feature_version 저장과 같은 tx에서 부른다 */
  setLinks(featureId: string, version: string, links: readonly FeatureRefLink[]) {
    this.db.run('DELETE FROM feature_ref_link WHERE feature_id = ? AND version = ?', featureId, version);
    for (const l of links) this.db.run('INSERT INTO feature_ref_link (feature_id, version, ref_id, role) VALUES (?, ?, ?, ?)', featureId, version, l.refId, l.role);
  }

  /** 같은 국가·차종·트림에서 이 기준 행을 대표로 쓰는 다른 Feature(D-REF-13) */
  primaryUsersInScope(refId: string, scope: { country: string; vehicleModel: string; trim: string }, docs: { featureId: string; country: string; vehicleModel: string; trim: string; featureRefs?: FeatureRefLink[] }[]) {
    return docs.filter((f) => f.country === scope.country && f.vehicleModel === scope.vehicleModel && f.trim === scope.trim && f.featureRefs?.some((l) => l.role === 'PRIMARY' && l.refId === refId));
  }
}

@Controller('api/refdb')
export class RefdbController {
  constructor(private readonly s: RefdbService) {}

  @Get('refs')
  refs(@Query('q') q?: string, @Query('domain') domain?: string, @Query('component') component?: string, @Query('status') status?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const n = (v?: string) => (v === undefined || v === '' ? undefined : Number.isInteger(Number(v)) ? Number(v) : NaN);
    const lim = n(limit);
    const off = n(offset);
    if (Number.isNaN(lim) || Number.isNaN(off)) throw new DomainError('VALIDATION', 'limit·offset은 정수입니다.');
    return this.s.search({ q, domain, component, status, limit: lim, offset: off });
  }

  @Get('refs/:refId')
  ref(@Param('refId') refId: string) {
    return this.s.detail(refId);
  }

  @Get('taxonomy')
  taxonomy() {
    return { items: this.s.taxonomy() };
  }

  @Get('overview')
  overview() {
    return this.s.overview();
  }

  @Post('requests')
  @Roles('FEATURE_AUTHOR')
  @AuditAction('FEATURE_REF_REQUEST')
  request(@CurrentActor() actor: Actor, @Body(new ZodPipe(FeatureRefRequestBody)) body: FeatureRefRequestBody) {
    return this.s.request(actor, body);
  }
}
