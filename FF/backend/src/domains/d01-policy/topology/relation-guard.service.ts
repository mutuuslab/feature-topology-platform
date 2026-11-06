// 관계 등록 경고·변경 영향 범위(D01-02, P3) — excludes 두 Feature의 동시 활성화(FR-DEP-009-003: 정책·차량 단위)와
// 의존관계 변경 영향의 차량·정책·OTA 범위(FR-DEP-003-001). 판정 규칙은 contracts rules/relation-types, 차량 단위는 서버 기준 활성화 판단(D01-09)을 그대로 쓴다.
import { Inject, Injectable } from '@nestjs/common';
import { concurrentExclusivePolicies, liveForVehicles, type DependencyRow, type Policy } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ActivationService } from '../activation/activation.service';
import { FleetRepo, PolicyRepo } from '../policy-repos';
import { FeatureRepo, TopologyRepo } from '../repos';
import { TraceLinkRepo } from '../registry/trace-link.repo';

/** 차량 단위 검사 상한 — 넘으면 앞에서부터 이만큼만 평가하고 truncated로 알린다 */
export const EXCLUSION_VEHICLE_LIMIT = 500;
const SAMPLE = 10;
const brief = (p: Policy) => ({ policyId: p.policyId, featureId: p.featureId, featureVersion: p.featureVersion, flagKey: p.flagKey, status: p.status, enabled: p.enabled });

@Injectable()
@PlatformComponent('D01-02')
export class RelationGuardService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly topology: TopologyRepo,
    private readonly policies: PolicyRepo,
    private readonly fleet: FleetRepo,
    private readonly features: FeatureRepo,
    private readonly activation: ActivationService,
    private readonly links: TraceLinkRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  /** excludes 관계의 동시 활성화 — 두 Feature 모두 켜질 수 있는 배포 정책이 있으면 같은 범위 차량마다 양쪽이 실제로 켜지는지 본다 @req FR-DEP-009-003 */
  async exclusionCheck(dependencyId: string) {
    const d = this.topology.get(dependencyId);
    if (!d) throw new DomainError('NOT_FOUND', `${dependencyId}을(를) 찾을 수 없습니다.`);
    return this.check(d);
  }

  /** 등록 직후 경고 — 동시 활성화가 있으면 감사·이벤트로 남긴다(등록은 막지 않는다: 배포 쪽 차단은 Catalog·정책 검증) */
  async warnOnCreate(actor: Actor, d: DependencyRow) {
    const r = await this.check(d);
    if (!r.conflict) return r;
    this.db.tx(() => {
      this.audit.record(actor, 'DEPENDENCY_EXCLUSION_WARNING', d.dependencyId, { after: { policies: r.policies, vehicles: { both: r.vehicles.both, checked: r.vehicles.checked } }, componentId: 'D01-02' });
      this.events.publish('dependency.exclusion-warning', d.dependencyId, { sourceFeatureId: d.sourceFeatureId, targetFeatureId: d.targetFeatureId, vehicles: r.vehicles.both }, { componentId: 'D01-02', correlationId: actor.correlationId });
    });
    return r;
  }

  private async check(d: DependencyRow) {
    const base = { dependencyId: d.dependencyId, type: d.type, sourceFeatureId: d.sourceFeatureId, targetFeatureId: d.targetFeatureId, scope: `${d.country}/${d.vehicleModel}/${d.trim}` };
    if (d.type !== 'EXCLUDES') return { ...base, applicable: false, conflict: false, level: null, policies: { source: [], target: [] }, vehicles: { checked: 0, both: 0, truncated: false, sample: [] as string[] } };
    const pol = concurrentExclusivePolicies(this.policies.all(), d.sourceFeatureId, d.targetFeatureId);
    const vehicles = { checked: 0, both: 0, truncated: false, sample: [] as string[] };
    if (pol.conflict) {
      const pool = this.fleet.vehiclesInScope([{ country: d.country, vehicleModel: d.vehicleModel, trim: d.trim }]);
      vehicles.truncated = pool.length > EXCLUSION_VEHICLE_LIMIT;
      const on = async (vin: string, ps: Policy[]) => {
        for (const p of ps) if ((await this.activation.decide(vin, p.flagKey).catch(() => null))?.result.value) return true;
        return false;
      };
      for (const v of pool.slice(0, EXCLUSION_VEHICLE_LIMIT)) {
        vehicles.checked++;
        if ((await on(v.vin, pol.source)) && (await on(v.vin, pol.target))) {
          vehicles.both++;
          if (vehicles.sample.length < SAMPLE) vehicles.sample.push(v.vin);
        }
      }
    }
    const level = vehicles.both ? 'VEHICLE' : pol.conflict ? 'POLICY' : null;
    return { ...base, applicable: true, conflict: pol.conflict, level, policies: { source: pol.source.map(brief), target: pol.target.map(brief) }, vehicles };
  }

  /** 변경 영향의 차량·정책·OTA 범위 — 바뀐 Feature와 그것을 REQUIRES 하는 Feature들(영향 분석 dependents) @req FR-DEP-003-001 */
  scope(featureId: string, dependents: string[]) {
    const affected = new Set([featureId, ...dependents]);
    const pols = this.policies.all().filter((p) => affected.has(p.featureId) && p.status !== 'RETIRED' && p.status !== 'REJECTED');
    const live = pols.filter(liveForVehicles);
    const scopes = new Map<string, { country: string; vehicleModel: string; trim: string }>();
    for (const p of live) {
      const f = this.features.get(p.featureId, p.featureVersion);
      if (f) scopes.set(`${f.country}/${f.vehicleModel}/${f.trim}`, { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim });
    }
    const byScope = [...scopes.entries()].map(([scope, s]) => ({ scope, vehicles: this.fleet.vehiclesInScope([s]).length }));
    const pool = this.fleet.vehiclesInScope([...scopes.values()]);
    const ota = this.links.list({ kind: 'OTA', status: 'ACTIVE' }).filter((l) => affected.has(l.featureId));
    return {
      policies: pols.map((p) => ({ ...brief(p), direct: p.featureId === featureId, live: liveForVehicles(p) })),
      vehicles: { total: pool.length, byScope, sample: pool.slice(0, SAMPLE).map((v) => v.vin) },
      ota: ota.map((l) => ({ linkId: l.linkId, featureId: l.featureId, packageId: l.elementId, name: l.elementName, version: l.elementVersion, direct: l.featureId === featureId })),
    };
  }
}
