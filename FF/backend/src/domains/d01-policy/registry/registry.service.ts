// Feature Registry (D01-01) — Feature ID+Version의 유일한 쓰기 지점 (상세설계서 §3, 표 20).
// ID 등록·중복 확인 / PROPOSED 초안 수정 / APPROVED 이후 변경은 새 Version / 조회·역추적.
import { Inject, Injectable } from '@nestjs/common';
import { SafetyProfileService } from './safety-profile.service';
import {
  bumpVersion,
  changedKeys,
  compareVersion,
  gatesToRejudge,
  SCOPE_KEYS,
  type CreateFeatureBody,
  type CreateVersionBody,
  type FeatureVersionRow,
  type UpdateDraftBody,
} from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { BaselineRepo, FeatureRepo, GateRepo, ProductRepo, TopologyRepo } from '../repos';
import { LifecycleService } from './lifecycle.service';
import { pageOf } from '../../../kernel/paging';
import { FeatureRefLinker, regulationsOf, type RefLinkResult, type RefWarning } from './feature-refs';

export interface FeatureQuery {
  q?: string;
  lifecycle?: string;
  country?: string;
  vehicleModel?: string;
  latestOnly?: boolean;
  /** 페이지 크기 — 없으면 전체(뒤 호환, 출시 준비 RD-UX-03) */
  limit?: number;
  /** 이전 응답의 nextCursor */
  cursor?: string;
}

@Injectable()
@PlatformComponent('D01-01')
export class RegistryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
    private readonly gates: GateRepo,
    private readonly topology: TopologyRepo,
    private readonly baselines: BaselineRepo,
    private readonly products: ProductRepo,
    private readonly lifecycle: LifecycleService,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
    private readonly safety: SafetyProfileService,
    private readonly refs: FeatureRefLinker,
  ) {}

  /** gateStatus — 목록은 GateRepo.latestStatuses로 한 번에 읽어 넘긴다(버전마다 Gate 질의를 하면 N+1) */
  private summary(f: FeatureVersionRow, latestVersion: string, gateStatus?: Record<string, string>) {
    const gates = gateStatus ?? Object.fromEntries(Object.entries(this.gates.latest(f.featureId, f.version)).map(([g, r]) => [g, r!.status]));
    return {
      featureId: f.featureId,
      version: f.version,
      isLatest: f.version === latestVersion,
      name: f.name,
      country: f.country,
      vehicleModel: f.vehicleModel,
      trim: f.trim,
      lifecycle: f.lifecycle,
      baselineId: f.baselineId,
      ownerId: f.ownerId,
      asil: f.asil,
      tags: f.tags,
      controlPoints: f.controlPoints,
      gates,
    };
  }

  list(q: FeatureQuery = {}) {
    const all = this.features.all();
    const latestOf = new Map<string, string>();
    for (const f of all) if (!latestOf.has(f.featureId) || compareVersion(f.version, latestOf.get(f.featureId)!) > 0) latestOf.set(f.featureId, f.version);
    const needle = q.q?.trim().toLowerCase();
    const matched = all
      .filter((f) => !q.lifecycle || f.lifecycle === q.lifecycle)
      .filter((f) => !q.country || f.country === q.country)
      .filter((f) => !q.vehicleModel || f.vehicleModel === q.vehicleModel)
      .filter((f) => !q.latestOnly || latestOf.get(f.featureId) === f.version)
      .filter((f) => !needle || [f.featureId, f.name, f.ownerId, ...f.tags].some((s) => s.toLowerCase().includes(needle)));
    const count = (k: 'lifecycle' | 'country' | 'vehicleModel') => {
      const m: Record<string, number> = {};
      for (const f of all) m[f[k]] = (m[f[k]] ?? 0) + 1;
      return m;
    };
    // 커서 페이지 — total·facets는 필터 결과 전체 기준(페이지마다 같다). 요약(Gate 상태)은 돌려줄 페이지만 만든다(출시 준비 RD-P2-01)
    const page = pageOf(matched, q.limit, q.cursor);
    if (!page) throw new DomainError('VALIDATION', '목록 커서를 읽을 수 없습니다. 처음 페이지부터 다시 불러오세요.', { field: 'cursor' });
    // 큰 페이지(전체·최신 버전 전체)는 Gate 상태 전체를 한 번에, 작은 페이지는 그 Feature들만
    const gates = this.gates.latestStatuses(page.items.length > 200 ? null : page.items);
    const items = page.items.map((f) => this.summary(f, latestOf.get(f.featureId)!, gates.get(`${f.featureId}@${f.version}`) ?? {}));
    return { total: matched.length, items, nextCursor: page.nextCursor, facets: { lifecycle: count('lifecycle'), country: count('country'), vehicleModel: count('vehicleModel') } };
  }

  versions(featureId: string) {
    const vs = this.features.versions(featureId);
    if (!vs.length) throw new DomainError('NOT_FOUND', `${featureId}을(를) 찾을 수 없습니다.`);
    const latest = vs[vs.length - 1].version;
    return { featureId, name: vs[vs.length - 1].name, latestVersion: latest, versions: vs.map((v) => this.summary(v, latest)), rationale: this.topology.rationale(featureId) ?? null };
  }

  /** 상세 — 19 속성 + Gate + 의존관계(양방향) + 구현 추적 + Baseline + 사용 상품 + 가능한 전이 */
  detail(featureId: string, version: string, actor?: Actor) {
    const f = this.lifecycle.require(featureId, version);
    const baseline = f.baselineId ? this.baselines.get(f.baselineId) ?? null : null;
    const functions = this.topology.functions(featureId, version);
    const trace = f.swIds.map((swId, i) => {
      const swVersion = f.swVersions[i] ?? null;
      const ecuPno = f.ecuPnos[i] ?? null;
      const sw = swVersion ? this.topology.sw(swId, swVersion).find((s) => !ecuPno || s.ecuPno === ecuPno) ?? null : null;
      return { function: f.functions[i] ?? null, swId, swVersion, ecuPno, sw, ecu: ecuPno ? this.topology.ecu(ecuPno) ?? null : null };
    });
    return {
      feature: f,
      meta: this.features.meta(featureId, version),
      gates: this.gates.latest(featureId, version),
      dependencies: { outgoing: this.topology.outgoing(featureId, version), incoming: this.topology.incoming(featureId) },
      functions,
      trace,
      baseline,
      products: baseline ? this.products.usingBaseline(baseline.baselineId) : [],
      pendingBaselineRequest: this.baselines.pendingFor(featureId, version) ?? null,
      transitions: this.lifecycle.options(f, actor),
      versions: this.features.versions(featureId).map((v) => ({ version: v.version, lifecycle: v.lifecycle, baselineId: v.baselineId })),
    };
  }

  /**
   * 기준 기능(Feature DB) 연결 판정만 — 저장하지 않는다(30-95 §6.2). 거부 감사는 남기지 않으므로 호출자가 남긴다.
   * JIRA Epic 자동 등록이 트랜잭션 밖에서 먼저 확인할 때 쓴다(거부 감사는 트랜잭션 밖이어야 한다).
   */
  checkRefs(body: CreateFeatureBody): RefLinkResult {
    return this.refs.resolve({
      featureRefs: body.featureRefs,
      asil: body.asil,
      asilDeviation: body.asilDeviation,
      scope: { country: body.country, vehicleModel: body.vehicleModel, trim: body.trim },
      duplicate: 'reject',
      confirmDuplicate: body.confirmDuplicate,
      duplicateReason: body.duplicateReason,
    });
  }

  /** 등록 — 기준 행 연결 필수(대표 1 + 포함 N). 요청 중·검토 필요·폐기 예정 행은 등록하되 응답 warnings와 감사에 남긴다 */
  create(actor: Actor, body: CreateFeatureBody): FeatureVersionRow & { warnings: RefWarning[] } {
    const fail = (reason: string) => {
      // 거부 감사는 트랜잭션 밖에서만 남길 수 있다 — 바깥 트랜잭션(JIRA 자동 등록)은 호출자가 먼저 확인하고 남긴다
      if (!this.db.inTransaction) this.audit.failed(actor, 'FEATURE_CREATE', body.name, reason, 'D01-01');
    };
    const dup = this.features.similar(body.name, body.country, body.vehicleModel, body.trim);
    if (dup.length) {
      fail('같은 적용 범위에 유사 Feature 존재');
      throw new DomainError('CONFLICT', '같은 국가·차종·트림에 이름이 비슷한 Feature가 이미 있습니다. 기존 Feature의 새 Version인지 확인하세요.', {
        similar: dup.map((d) => ({ featureId: d.featureId, version: d.version, name: d.name, lifecycle: d.lifecycle })),
      });
    }
    let linked: RefLinkResult;
    try {
      linked = this.checkRefs(body);
    } catch (e) {
      if (e instanceof DomainError) fail(`기준 기능 연결: ${e.message}`);
      throw e;
    }
    return this.db.tx(() => {
      const f: FeatureVersionRow = {
        featureId: this.features.nextFeatureId(),
        name: body.name,
        description: body.description,
        requirementIds: body.requirementIds,
        country: body.country,
        vehicleModel: body.vehicleModel,
        trim: body.trim,
        version: '0.1.0',
        baselineId: null,
        lifecycle: 'PROPOSED',
        ownerId: body.ownerId,
        tags: body.tags,
        asil: body.asil,
        upgVc: body.upgVc,
        functions: [],
        swIds: [],
        swVersions: [],
        ecuPnos: [],
        controlPoints: body.controlPoints,
        dependencyIds: [],
        catalogIds: [],
        gateRecordIds: [],
        featureRefs: linked.featureRefs,
        ...(linked.asilDeviation ? { asilDeviation: linked.asilDeviation } : {}),
        // 규제·표준 조항은 요구사항 ID가 아니다 — 따로 보존하고, 주지 않으면 대표 행에서 미리 채운다(§6.3)
        refRegulations: body.refRegulations ?? regulationsOf(linked.primary),
        _missing: { baselineId: '미발급', functions: '미입력', swIds: '미입력', swVersions: '미입력', ecuPnos: '미입력' },
      };
      this.features.insert(f, { createdBy: actor.id, createdAt: this.clock.iso() });
      this.refs.saveLinks(f); // 기준 행 → Feature 역참조 색인(§5.3) — 같은 트랜잭션
      this.safety.ensure(f.featureId, f.version); // 안전 분류 초안 — 앞 Version 값을 잇거나 추정(보고서 5.7)
      const target = `${f.featureId}@${f.version}`;
      this.audit.record(actor, 'FEATURE_CREATE', target, { after: { ...f, ...refAuditDetail(linked, body.duplicateReason) }, componentId: 'D01-01' });
      this.events.publish(
        'feature.created',
        target,
        { featureId: f.featureId, version: f.version, name: f.name, primaryRef: linked.primary.refId, asilDeviation: !!linked.asilDeviation },
        { componentId: 'D01-01', correlationId: actor.correlationId },
      );
      return { ...f, warnings: linked.warnings };
    });
  }

  /** 초안 수정·새 Version의 연결 다시 판정 — 연결·ASIL·사유 중 하나라도 바뀌면. 연결이 아직 없는 시드 Feature는 연결을 줄 때만 본다 */
  private relink(f: FeatureVersionRow, body: UpdateDraftBody): RefLinkResult | null {
    if (body.featureRefs === undefined && body.asil === undefined && body.asilDeviation === undefined) return null;
    const featureRefs = body.featureRefs ?? f.featureRefs;
    if (!featureRefs?.length) return null;
    return this.refs.resolve({
      featureRefs,
      previous: f.featureRefs,
      asil: body.asil ?? f.asil,
      asilDeviation: body.asilDeviation ?? f.asilDeviation,
      scope: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim },
      featureId: f.featureId,
      duplicate: 'warn', // 이미 등록된 Feature — 확인 칸이 없으므로 경고만
    });
  }

  /** 연결 판정 결과를 행에 반영 — 대표 ASIL과 같아지면 사유를 지운다 */
  private withLinks(next: FeatureVersionRow, linked: RefLinkResult | null): FeatureVersionRow {
    if (!linked) return next;
    const { asilDeviation: _drop, ...rest } = next;
    return { ...rest, featureRefs: linked.featureRefs, ...(linked.asilDeviation ? { asilDeviation: linked.asilDeviation } : {}) };
  }

  /** PROPOSED 초안만 그 자리에서 수정한다. APPROVED 이후는 새 Version. */
  updateDraft(actor: Actor, featureId: string, version: string, body: UpdateDraftBody) {
    const f = this.lifecycle.require(featureId, version);
    const target = `${featureId}@${version}`;
    if (f.lifecycle !== 'PROPOSED') {
      this.audit.failed(actor, 'FEATURE_UPDATE', target, `${f.lifecycle} 버전 수정 시도`, 'D01-01');
      throw new DomainError('IMMUTABLE', `${f.lifecycle} 버전은 수정할 수 없습니다. 새 Version을 만드세요.`, { hint: `POST /api/features/${featureId}/versions` });
    }
    let linked: RefLinkResult | null;
    try {
      linked = this.relink(f, body);
    } catch (e) {
      if (e instanceof DomainError) this.audit.failed(actor, 'FEATURE_UPDATE', target, `기준 기능 연결: ${e.message}`, 'D01-01');
      throw e;
    }
    return this.db.tx(() => {
      const next = this.withLinks(this.merge(f, body), linked);
      this.features.update(next);
      if (linked) this.refs.saveLinks(next);
      const changed = changedKeys(f, body as any);
      this.audit.record(actor, 'FEATURE_UPDATE', target, { before: pick(f, changed), after: { ...pick(next, changed), ...(linked ? refAuditDetail(linked) : {}) }, componentId: 'D01-01' });
      this.events.publish('feature.updated', target, { featureId, version, changed }, { componentId: 'D01-01', correlationId: actor.correlationId });
      return linked ? { ...next, warnings: linked.warnings } : next;
    });
  }

  /** 새 Version — 이전 Version과 그 Baseline은 그대로 남고, 새 Version은 PROPOSED에서 다시 Gate·BOM 승인을 받는다. */
  createVersion(actor: Actor, featureId: string, body: CreateVersionBody) {
    const base = this.lifecycle.require(featureId, body.baseVersion);
    const scopeChange = SCOPE_KEYS.filter((k) => k in (body.changes as object));
    if (scopeChange.length) throw new DomainError('VALIDATION', '국가·차종·트림이 바뀌면 새 Feature ID로 등록해야 합니다.', { fields: scopeChange });
    if (base.lifecycle === 'RETIRED') throw new DomainError('GUARD_FAILED', 'RETIRED Feature에서는 새 Version을 만들 수 없습니다.');
    const latest = this.features.versions(featureId).at(-1)!.version;
    const version = bumpVersion(latest, body.bump);
    const changed = changedKeys(base, body.changes as any);
    // 기준 행 연결은 앞 버전에서 복사한다(§5.3) — 바꾸면 다시 판정
    const linked = this.relink(base, body.changes);
    return this.db.tx(() => {
      const merged = this.withLinks(this.merge(base, body.changes), linked);
      const f: FeatureVersionRow = { ...merged, version, lifecycle: 'PROPOSED', baselineId: null, catalogIds: [], gateRecordIds: [], _missing: { ...merged._missing, baselineId: '미발급' } };
      this.features.insert(f, { createdBy: actor.id, createdAt: this.clock.iso() });
      this.refs.saveLinks(f); // 앞 버전 연결(또는 바뀐 연결)을 새 버전 색인으로
      this.safety.ensure(f.featureId, f.version, base.version); // 안전 분류 초안 — 기준 Version 값을 잇는다(보고서 5.7, DRAFT)
      const target = `${featureId}@${version}`;
      const rejudge = gatesToRejudge(changed, base.lifecycle);
      this.audit.record(actor, 'FEATURE_VERSION_CREATE', target, { before: { baseVersion: base.version }, after: { version, changed, rejudge }, reason: body.reason, componentId: 'D01-01' });
      this.events.publish(
        'feature.version.created',
        target,
        // 기존 Baseline이 있는 Feature의 새 Version → BOM 승인자에게 변경 알림 (표 13 ①)
        { featureId, version, baseVersion: base.version, changed, rejudge, notifyBomApprover: !!base.baselineId },
        { componentId: 'D01-01', correlationId: actor.correlationId },
      );
      return { feature: f, changed, rejudge, ...(linked ? { warnings: linked.warnings } : {}) };
    });
  }

  private merge(f: FeatureVersionRow, body: UpdateDraftBody): FeatureVersionRow {
    const next = { ...f, ...stripUndefined(body) } as FeatureVersionRow;
    const missing = { ...f._missing };
    for (const k of Object.keys(body)) if (!isEmpty((next as any)[k])) delete missing[k];
    return { ...next, _missing: missing };
  }
}

const isEmpty = (v: unknown) => v == null || (Array.isArray(v) && v.length === 0) || v === '';
const stripUndefined = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
/** 감사 기록에 남기는 연결 판정 — 경고·ASIL 사유(G2 검토)·같은 범위 중복 확인 사유 */
const refAuditDetail = (linked: RefLinkResult, duplicateReason?: string) => ({
  refWarnings: linked.warnings,
  ...(linked.asilDeviation ? { asilDeviationReview: 'G2' } : {}),
  ...(duplicateReason && linked.duplicates.length ? { duplicateConfirmed: { reason: duplicateReason, of: linked.duplicates } } : {}),
});
const pick = (o: object, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (o as any)[k]]));
