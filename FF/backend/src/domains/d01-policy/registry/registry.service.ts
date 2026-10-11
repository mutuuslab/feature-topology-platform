// Feature Registry (D01-01) — Feature ID+Version의 유일한 쓰기 지점 (상세설계서 §3, 표 20).
// ID 등록·중복 확인 / PROPOSED 초안 수정 / APPROVED 이후 변경은 새 Version / 조회·역추적.
import { Inject, Injectable } from '@nestjs/common';
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

export interface FeatureQuery {
  q?: string;
  lifecycle?: string;
  country?: string;
  vehicleModel?: string;
  latestOnly?: boolean;
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
  ) {}

  private summary(f: FeatureVersionRow, latestVersion: string) {
    const latest = this.gates.latest(f.featureId, f.version);
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
      gates: Object.fromEntries(Object.entries(latest).map(([g, r]) => [g, r!.status])),
    };
  }

  list(q: FeatureQuery = {}) {
    const all = this.features.all();
    const latestOf = new Map<string, string>();
    for (const f of all) if (!latestOf.has(f.featureId) || compareVersion(f.version, latestOf.get(f.featureId)!) > 0) latestOf.set(f.featureId, f.version);
    const needle = q.q?.trim().toLowerCase();
    const items = all
      .filter((f) => !q.lifecycle || f.lifecycle === q.lifecycle)
      .filter((f) => !q.country || f.country === q.country)
      .filter((f) => !q.vehicleModel || f.vehicleModel === q.vehicleModel)
      .filter((f) => !q.latestOnly || latestOf.get(f.featureId) === f.version)
      .filter((f) => !needle || [f.featureId, f.name, f.ownerId, ...f.tags].some((s) => s.toLowerCase().includes(needle)))
      .map((f) => this.summary(f, latestOf.get(f.featureId)!));
    const count = (k: 'lifecycle' | 'country' | 'vehicleModel') => {
      const m: Record<string, number> = {};
      for (const f of all) m[f[k]] = (m[f[k]] ?? 0) + 1;
      return m;
    };
    return { total: items.length, items, facets: { lifecycle: count('lifecycle'), country: count('country'), vehicleModel: count('vehicleModel') } };
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

  create(actor: Actor, body: CreateFeatureBody) {
    const dup = this.features.similar(body.name, body.country, body.vehicleModel, body.trim);
    if (dup.length) {
      this.audit.failed(actor, 'FEATURE_CREATE', body.name, '같은 적용 범위에 유사 Feature 존재', 'D01-01');
      throw new DomainError('CONFLICT', '같은 국가·차종·트림에 이름이 비슷한 Feature가 이미 있습니다. 기존 Feature의 새 Version인지 확인하세요.', {
        similar: dup.map((d) => ({ featureId: d.featureId, version: d.version, name: d.name, lifecycle: d.lifecycle })),
      });
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
        _missing: { baselineId: '미발급', functions: '미입력', swIds: '미입력', swVersions: '미입력', ecuPnos: '미입력' },
      };
      this.features.insert(f, { createdBy: actor.id, createdAt: this.clock.iso() });
      const target = `${f.featureId}@${f.version}`;
      this.audit.record(actor, 'FEATURE_CREATE', target, { after: f, componentId: 'D01-01' });
      this.events.publish('feature.created', target, { featureId: f.featureId, version: f.version, name: f.name }, { componentId: 'D01-01', correlationId: actor.correlationId });
      return f;
    });
  }

  /** PROPOSED 초안만 그 자리에서 수정한다. APPROVED 이후는 새 Version. */
  updateDraft(actor: Actor, featureId: string, version: string, body: UpdateDraftBody) {
    const f = this.lifecycle.require(featureId, version);
    const target = `${featureId}@${version}`;
    if (f.lifecycle !== 'PROPOSED') {
      this.audit.failed(actor, 'FEATURE_UPDATE', target, `${f.lifecycle} 버전 수정 시도`, 'D01-01');
      throw new DomainError('IMMUTABLE', `${f.lifecycle} 버전은 수정할 수 없습니다. 새 Version을 만드세요.`, { hint: `POST /api/features/${featureId}/versions` });
    }
    return this.db.tx(() => {
      const next = this.merge(f, body);
      this.features.update(next);
      this.audit.record(actor, 'FEATURE_UPDATE', target, { before: pick(f, changedKeys(f, body as any)), after: pick(next, changedKeys(f, body as any)), componentId: 'D01-01' });
      this.events.publish('feature.updated', target, { featureId, version, changed: changedKeys(f, body as any) }, { componentId: 'D01-01', correlationId: actor.correlationId });
      return next;
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
    return this.db.tx(() => {
      const merged = this.merge(base, body.changes);
      const f: FeatureVersionRow = { ...merged, version, lifecycle: 'PROPOSED', baselineId: null, catalogIds: [], gateRecordIds: [], _missing: { ...merged._missing, baselineId: '미발급' } };
      this.features.insert(f, { createdBy: actor.id, createdAt: this.clock.iso() });
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
      return { feature: f, changed, rejudge };
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
const pick = (o: object, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (o as any)[k]]));
