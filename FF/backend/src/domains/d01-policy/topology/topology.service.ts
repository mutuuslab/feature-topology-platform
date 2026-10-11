// Feature Topology (D01-02) — 의존관계 등록·판정, 관계 그래프, 사전점검(DATA-PRECHECK), 변경 영향.
// Topology는 원천 속성을 소유하지 않는다: 판정 이력·Gate Record·영향 결과만 만들고 Registry·Catalog가 소비한다.
import { Inject, Injectable } from '@nestjs/common';
import {
  gatesToRejudge,
  judgeDependency,
  runDataQuality,
  runPrecheck,
  validateNewDependency,
  type CreateDependencyBody,
  type Dataset,
  type DependencyRow,
  type FeatureVersionRow,
} from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { BaselineRepo, FeatureRepo, GateRepo, ProductRepo, TopologyRepo } from '../repos';

export const RULE_VERSION = 'DATA-PRECHECK-1.0';

@Injectable()
@PlatformComponent('D01-02')
export class TopologyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
    private readonly topology: TopologyRepo,
    private readonly gates: GateRepo,
    private readonly baselines: BaselineRepo,
    private readonly products: ProductRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  list(q: { featureId?: string; type?: string; verdict?: string } = {}) {
    return this.topology
      .all()
      .filter((d) => !q.featureId || d.sourceFeatureId === q.featureId || d.targetFeatureId === q.featureId)
      .filter((d) => !q.type || d.type === q.type)
      .filter((d) => !q.verdict || d.verdict === q.verdict);
  }

  create(actor: Actor, body: CreateDependencyBody): DependencyRow {
    const source = this.features.get(body.sourceFeatureId, body.sourceVersion);
    const target = body.targetVersion ? this.features.get(body.targetFeatureId, body.targetVersion) : undefined;
    const label = `${body.sourceFeatureId}@${body.sourceVersion} ${body.type} ${body.targetFeatureId}@${body.targetVersion ?? '?'}`;
    const reject = (code: 'NOT_FOUND' | 'IMMUTABLE' | 'GUARD_FAILED', msg: string, details?: unknown): never => {
      this.audit.failed(actor, 'DEPENDENCY_CREATE', label, msg, 'D01-02');
      throw new DomainError(code, msg, details);
    };
    if (!source) reject('NOT_FOUND', `원천 ${body.sourceFeatureId} ${body.sourceVersion}이(가) Registry에 없습니다.`);
    if (source!.lifecycle !== 'PROPOSED') reject('IMMUTABLE', `원천 버전이 ${source!.lifecycle}입니다 — 의존관계 변경은 새 Version에서 하세요 (재판정 G1·G3).`);
    if (body.targetVersion && !target) reject('NOT_FOUND', `대상 ${body.targetFeatureId} ${body.targetVersion}이(가) Registry에 없습니다.`);
    if (!body.targetVersion && !this.features.versions(body.targetFeatureId).length) reject('NOT_FOUND', `대상 ${body.targetFeatureId}이(가) Registry에 없습니다.`);
    const issues = validateNewDependency(this.topology.all(), body, source!, target);
    if (issues.length) reject('GUARD_FAILED', issues.map((i) => i.message).join(' / '), { issues });

    return this.db.tx(() => {
      const draft = {
        dependencyId: this.topology.nextId(),
        type: body.type,
        sourceFeatureId: body.sourceFeatureId,
        sourceVersion: body.sourceVersion,
        targetFeatureId: body.targetFeatureId,
        targetVersion: body.targetVersion,
        country: source!.country,
        vehicleModel: source!.vehicleModel,
        trim: source!.trim,
        // 대상 Feature에 버전이 하나뿐이면 '단일 후보', 여럿 중 고른 것이면 '버전 확정'
        targetVersionCheck: this.features.versions(body.targetFeatureId).length > 1 ? ('버전 확정' as const) : ('단일 후보' as const),
        ruleVersion: RULE_VERSION,
        _missing: body.targetVersion ? {} : { targetVersion: '미입력' as const },
      };
      const j = judgeDependency(draft, source, target);
      const dep: DependencyRow = { ...draft, verdict: j.verdict, rationale: j.rationale };
      this.topology.insert(dep);
      // 의존관계 목록은 Feature 속성 — 원천(PROPOSED) 초안에 반영
      const missing = { ...source!._missing };
      delete missing.dependencyIds;
      this.features.update({ ...source!, dependencyIds: [...source!.dependencyIds, dep.dependencyId].sort(), _missing: missing });
      this.audit.record(actor, 'DEPENDENCY_CREATE', label, { after: dep, componentId: 'D01-02' });
      this.events.publish('dependency.created', `${body.sourceFeatureId}@${body.sourceVersion}`, { dependencyId: dep.dependencyId, verdict: dep.verdict }, { componentId: 'D01-02', correlationId: actor.correlationId });
      return dep;
    });
  }

  /** 원천 Version의 관계를 다시 판정한다 (Lifecycle 변경 시 — 예: 승인되면 미판정 → PASS). tx 안에서 호출. */
  rejudgeOutgoing(f: FeatureVersionRow, correlationId: string) {
    for (const d of this.topology.outgoing(f.featureId, f.version)) {
      const target = d.targetVersion ? this.features.get(d.targetFeatureId, d.targetVersion) : undefined;
      const j = judgeDependency(d, f, target);
      if (j.verdict === d.verdict) continue;
      this.topology.update({ ...d, verdict: j.verdict, rationale: j.rationale });
      this.events.publish('dependency.rejudged', d.dependencyId, { from: d.verdict, to: j.verdict, rationale: j.rationale }, { componentId: 'D01-02', correlationId });
    }
  }

  /** 관계 그래프 (Cytoscape용) — featureId가 있으면 그 Feature 주변 depth 단계까지 */
  graph(featureId?: string, depth = 2) {
    const deps = this.topology.all();
    let keep: Set<string> | null = null;
    if (featureId) {
      keep = new Set([featureId]);
      for (let i = 0; i < depth; i++)
        for (const d of deps) if (keep.has(d.sourceFeatureId) || keep.has(d.targetFeatureId)) (keep.add(d.sourceFeatureId), keep.add(d.targetFeatureId));
    }
    const edges = deps.filter((d) => !keep || (keep.has(d.sourceFeatureId) && keep.has(d.targetFeatureId)));
    const ids = new Set(edges.flatMap((d) => [`${d.sourceFeatureId}@${d.sourceVersion}`, d.targetVersion ? `${d.targetFeatureId}@${d.targetVersion}` : d.targetFeatureId]));
    if (featureId) for (const v of this.features.versions(featureId)) ids.add(`${v.featureId}@${v.version}`);
    const nodes = [...ids].sort().map((id) => {
      const [fid, ver] = id.split('@');
      const f = ver ? this.features.get(fid, ver) : this.features.versions(fid).at(-1);
      return { id, featureId: fid, version: ver ?? null, name: f?.name ?? fid, lifecycle: f?.lifecycle ?? null, scope: f ? `${f.country}/${f.vehicleModel}/${f.trim}` : null, baselineId: f?.baselineId ?? null };
    });
    return {
      nodes,
      edges: edges.map((d) => ({ id: d.dependencyId, source: `${d.sourceFeatureId}@${d.sourceVersion}`, target: d.targetVersion ? `${d.targetFeatureId}@${d.targetVersion}` : d.targetFeatureId, type: d.type, verdict: d.verdict })),
    };
  }

  /** 현재 DB 상태 전체 — PRECHECK·영향 분석 입력 */
  dataset(): Dataset {
    return {
      features: this.features.all(),
      products: this.products.all(),
      bomItems: this.baselines.all().map((b) => b.snapshot),
      dependencies: this.topology.all(),
      gateRecords: this.gates.all(),
      featureFunctions: this.topology.allFunctions(),
      swMaster: this.topology.allSw(),
      ecuMaster: this.topology.allEcu(),
      versionRationale: this.topology.allRationale(),
      precheckRules: this.gates.precheckRules(),
      evidence: this.gates.allEvidence(),
    };
  }

  precheck() {
    const ds = this.dataset();
    const rules = runPrecheck(ds);
    const quality = runDataQuality(ds);
    const defs = new Map(ds.precheckRules.map((r) => [r.ruleId, r]));
    const count = (xs: { result: string }[], r: string) => xs.filter((x) => x.result === r).length;
    return {
      ruleVersion: RULE_VERSION,
      summary: { PASS: count(rules, 'PASS'), CONDITIONAL: count(rules, 'CONDITIONAL'), FAIL: count(rules, 'FAIL'), dataQualityFindings: quality.reduce((n, q) => n + q.findings.length, 0) },
      rules: rules.map((r) => ({ ...r, condition: defs.get(r.ruleId)?.condition ?? null, expected: defs.get(r.ruleId)?.exampleResult ?? null })),
      dataQuality: quality,
    };
  }

  /** 변경 영향 (표 8 '영향도') — 정방향 구현 추적, 역방향 REQUIRES, Baseline→Catalog 역추적, 재판정 Gate·담당자 */
  impact(featureId: string, version: string, changed: string[] = []) {
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    const deps = this.topology.all();
    // 이 Feature(어느 버전이든)를 REQUIRES 하는 원천들 — 다단계로 거슬러 올라간다
    const dependents: { dependencyId: string; featureId: string; version: string; name: string; lifecycle: string; depth: number; path: string[] }[] = [];
    const seen = new Set<string>([featureId]);
    let frontier = [{ id: featureId, path: [featureId] }];
    for (let depth = 1; frontier.length && depth <= 5; depth++) {
      const next: typeof frontier = [];
      for (const cur of frontier)
        for (const d of deps.filter((x) => x.type === 'REQUIRES' && x.targetFeatureId === cur.id)) {
          if (seen.has(d.sourceFeatureId)) continue;
          seen.add(d.sourceFeatureId);
          const src = this.features.get(d.sourceFeatureId, d.sourceVersion);
          const path = [...cur.path, d.sourceFeatureId];
          dependents.push({ dependencyId: d.dependencyId, featureId: d.sourceFeatureId, version: d.sourceVersion, name: src?.name ?? '', lifecycle: src?.lifecycle ?? '', depth, path });
          next.push({ id: d.sourceFeatureId, path });
        }
      frontier = next;
    }
    const excludes = deps.filter((d) => d.type === 'EXCLUDES' && (d.sourceFeatureId === featureId || d.targetFeatureId === featureId));
    const baselines = this.baselines.forFeature(featureId);
    const affectedFeatureIds = [featureId, ...dependents.map((d) => d.featureId)];
    const productHits = this.products
      .all()
      .map((p) => {
        const via = p.baselineIds
          .map((id) => this.baselines.get(id))
          .filter((b): b is NonNullable<typeof b> => !!b && affectedFeatureIds.includes(b.featureId))
          .map((b) => ({ baselineId: b.baselineId, featureId: b.featureId, version: b.version, direct: b.featureId === featureId }));
        return { catalogId: p.catalogId, version: p.version, name: p.name, lifecycle: p.lifecycle, ownerId: p.ownerId, via };
      })
      .filter((p) => p.via.length);
    const rejudge = gatesToRejudge(changed as (keyof FeatureVersionRow)[], f.lifecycle);
    const owners = [...new Set([f.ownerId, ...dependents.map((d) => this.features.get(d.featureId, d.version)?.ownerId ?? ''), ...productHits.map((p) => p.ownerId)].filter(Boolean))];
    return {
      feature: { featureId, version, name: f.name, lifecycle: f.lifecycle, baselineId: f.baselineId, ownerId: f.ownerId },
      forward: f.swIds.map((swId, i) => ({ function: f.functions[i] ?? null, swId, swVersion: f.swVersions[i] ?? null, ecuPno: f.ecuPnos[i] ?? null })),
      dependents,
      excludes,
      baselines: baselines.map((b) => ({ baselineId: b.baselineId, version: b.version, current: b.version === version })),
      products: productHits,
      rejudge,
      owners,
      summary: { dependents: dependents.length, products: productHits.length, releasedProducts: productHits.filter((p) => p.lifecycle === 'RELEASED').length, rejudgeGates: rejudge.length },
    };
  }
}
