// Feature DB 읽기(30-95 §6.1·§8.4) — 기준 행 검색·상세·분류·출처·품질 지표·발행 이력·세부기능 후보·내보내기.
// 벤치마크 필드(금액·Make/Buy)는 산정 역할만(read-view.ts, 20-94 §8). 검색 순위·패싯은 read-search.ts(순수 함수).
import { Injectable } from '@nestjs/common';
import { REF_PENDING_APPROVED, REF_STATUS_POLICY, REF_STATUSES, refQuality, type RefStatus, type Role, type TaxonomyNode } from '@ff/contracts';
import { Clock } from '../../../kernel/clock';
import { DomainError } from '../../../kernel/errors';
import { pageLimit, singleQuery } from '../../../kernel/paging';
import { RefdbExportService } from './export-refdb.service';
import { searchRefs } from './read-search';
import { refView } from './read-view';
import { readSeedRecord } from './refdb-seed';
import { RefdbRepository } from './refdb.repository';

export const REF_PAGE_DEFAULT = 50;
export const REF_PAGE_MAX = 200;

export interface RefListQuery {
  q?: unknown;
  domain?: unknown;
  component?: unknown;
  status?: unknown;
  offset?: unknown;
  limit?: unknown;
  source?: unknown;
}

const one = (raw: unknown, field: string) => singleQuery(raw, field)?.trim() || undefined;

function statusOf(raw: unknown): RefStatus | undefined {
  const v = one(raw, 'status');
  if (v === undefined) return undefined;
  if (!(REF_STATUSES as readonly string[]).includes(v)) throw new DomainError('VALIDATION', `상태는 ${REF_STATUSES.join('·')} 중 하나입니다.`, { field: 'status', value: v });
  return v as RefStatus;
}

function offsetOf(raw: unknown): number {
  const v = one(raw, 'offset');
  if (v === undefined) return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new DomainError('VALIDATION', '질의 offset은 0 이상의 정수입니다.', { field: 'offset', value: v });
  return n;
}

const featureSummary = (doc: string | null) => {
  if (!doc) return { name: null, country: null, vehicleModel: null, trim: null };
  const d = JSON.parse(doc) as { name?: string; country?: string; vehicleModel?: string; trim?: string };
  return { name: d.name ?? null, country: d.country ?? null, vehicleModel: d.vehicleModel ?? null, trim: d.trim ?? null };
};

@Injectable()
export class RefdbReadService {
  constructor(
    private readonly repo: RefdbRepository,
    private readonly clock: Clock,
    private readonly exporter: RefdbExportService,
  ) {}

  /** 검색(listRefs) — 페이지 + 전체 수 + 패싯(도메인·컴포넌트·상태). 결과 행에 세부기능 후보 수를 붙인다 */
  list(q: RefListQuery, role: Role) {
    const query = { q: one(q.q, 'q'), domain: one(q.domain, 'domain'), component: one(q.component, 'component'), status: statusOf(q.status), source: one(q.source, 'source') };
    const offset = offsetOf(q.offset);
    const limit = pageLimit(q.limit, REF_PAGE_MAX) ?? REF_PAGE_DEFAULT;
    // 검색어가 있을 때만 연결 Feature 이름을 모은다(이름 검색 — 'SCC'·'스마트 크루즈', P1-8)
    const { rows, facets } = searchRefs(this.repo.listRefs(), this.repo.glossary(), query, query.q ? this.repo.linkedFeatureNames() : undefined);
    const subCount = this.repo.subfunctionCounts();
    const items = rows.slice(offset, offset + limit).map((r) => ({ ...refView(r, role), subfunctionCount: subCount.get(r.component) ?? 0 }));
    return { items, total: rows.length, offset, limit, facets, release: this.repo.latestRelease()?.release ?? null };
  }

  /** 상세(refDetail) — 행 + 분류 경로 + 출처 + 세부기능 후보 + 이 행을 쓰는 Feature + 상태 정책 안내 */
  detail(refId: string, role: Role) {
    const ref = this.repo.getRef(refId);
    if (!ref) throw new DomainError('NOT_FOUND', `기준 행 ${refId}이(가) Feature DB에 없습니다.`, { refId });
    const tax = this.repo.taxonomy();
    const domain = tax.find((n) => n.level === 'DOMAIN' && n.nameEn === ref.domain) ?? null;
    const under = (level: TaxonomyNode['level'], name: string) => tax.find((n) => n.level === level && n.nameEn === name && (!domain || n.parentId === domain.nodeId)) ?? null;
    const sources = new Map(this.repo.sources().map((s) => [s.sourceId, s]));
    const policy = REF_STATUS_POLICY[ref.status];
    const replacement = ref.replacedBy ? this.repo.getRef(ref.replacedBy) : undefined;
    // 요청 중 행의 추가 요청이 이미 승인됐으면(발행 전) '관리자 승인 전'이 아니라 '승인됨 · 다음 발행 대기'(P5-3)
    const approvedAdd = ref.status === 'PENDING' ? this.repo.changes({ refId, kind: 'ADD', status: 'APPROVED' }).find((c) => c.release === null) : undefined;
    return {
      ref: refView(ref, role),
      taxonomy: { domain, cluster: under('CLUSTER', ref.cluster), component: under('COMPONENT', ref.component) },
      // 출처 ID가 출처 표에 없으면 source null — 이전 점검(data:check)이 막지만 화면은 깨지지 않게
      sources: ref.sourceIds.map((id) => ({ sourceId: id, source: sources.get(id) ?? null })),
      glossary: this.repo.glossary().filter((g) => g.refIds.includes(ref.refId)),
      subfunctions: this.repo.subfunctions(ref.component),
      usedBy: this.repo.linkedFeatures(refId).map((l) => ({ featureId: l.featureId, version: l.version, role: l.role, refVersion: l.refVersion, lifecycle: l.lifecycle, ...featureSummary(l.doc) })),
      policy: { status: ref.status, ...policy, replacedBy: replacement ? { refId: replacement.refId, nameKo: replacement.nameKo, status: replacement.status } : null },
      awaitingPublish: approvedAdd ? { changeId: approvedAdd.changeId, decidedAt: approvedAdd.decision?.at ?? null, label: REF_PENDING_APPROVED.label, hint: REF_PENDING_APPROVED.hint } : null,
    };
  }

  taxonomy() {
    return { items: this.repo.taxonomy() };
  }
  /** 출처 + 다음 점검일 없는 출처 수(정기 점검 알림이 걸리지 않는다 — 화면 경고, P5-5) + 출처별 사용 행 수 */
  sources() {
    const items = this.repo.sources();
    const used = new Map<string, number>();
    for (const r of this.repo.listRefs()) if (r.status !== 'RETIRED' && r.status !== 'PENDING') for (const id of r.sourceIds) used.set(id, (used.get(id) ?? 0) + 1);
    return { items: items.map((s) => ({ ...s, usedBy: used.get(s.sourceId) ?? 0 })), noNextReview: items.filter((s) => !s.nextReviewAt).length };
  }

  /** 품질 지표(refQuality) + 기준 행 연결이 없는 Feature 버전('확인 필요') — 시드 대응표에 없던 것은 사유·후보와 함께 */
  quality() {
    const q = refQuality(this.repo.listRefs(), this.repo.releases(), this.repo.changes(), this.clock.iso());
    const missing = new Map((readSeedRecord(this.repo)?.missing ?? []).map((m) => [m.featureId, m]));
    const items = this.repo.unlinkedFeatureVersions().map((f) => {
      const m = missing.get(f.featureId);
      return { featureId: f.featureId, version: f.version, lifecycle: f.lifecycle, name: featureSummary(f.doc).name, note: m?.featureRefs ?? null, candidates: m?.candidates ?? [] };
    });
    return { ...q, needsLink: { total: items.length, items } };
  }
  releases() {
    return { items: this.repo.releases() };
  }
  subfunctions(component?: unknown) {
    return { items: this.repo.subfunctions(one(component, 'component')) };
  }

  /** 내보내기(exportRefdb) — json·xlsx, 지난 발행 버전 포함. 변경 요청 담당(B3)의 export-refdb.service로 넘긴다 */
  export(format: unknown, release: unknown, role: Role) {
    return this.exporter.export(one(format, 'format'), one(release, 'release'), role);
  }
}
