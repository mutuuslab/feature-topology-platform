// 기준정보·추적 조회 (D01-02 Topology·구현 추적 · D01-01 변경 이력 · D04-02 Evidence) — v0.81 데이터셋 그대로.
// 레거시 기준정보 화면(UPG·SW·SW 구조·제어점·Taxonomy·요구 추적·Evidence·변경요청)을 v2로 바꾸면서 같은 원천을 API로 낸다(P10-C4).
import { Controller, Get, Injectable, Param, Query } from '@nestjs/common';
import { PlatformComponent } from '../../../kernel/components';
import { DomainError } from '../../../kernel/errors';
import { FleetRepo, PolicyRepo } from '../policy-repos';
import { SafetyProfileService } from '../registry/safety-profile.service';
import { BaselineRepo, FeatureRepo, GateRepo, TopologyRepo } from '../repos';

const latest = <T extends { featureId: string; version: string }>(rows: T[]) => {
  const by = new Map<string, T>();
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  for (const r of rows) {
    const cur = by.get(r.featureId);
    if (!cur || cmp(r.version, cur.version) > 0) by.set(r.featureId, r);
  }
  return [...by.values()].sort((a, b) => a.featureId.localeCompare(b.featureId));
};

@Injectable()
@PlatformComponent('D01-02')
export class MasterDataService {
  constructor(
    private readonly features: FeatureRepo,
    private readonly topology: TopologyRepo,
    private readonly gates: GateRepo,
    private readonly baselines: BaselineRepo,
    private readonly policies: PolicyRepo,
    private readonly fleet: FleetRepo,
    private readonly safety: SafetyProfileService,
  ) {}

  ecus() {
    const sw = this.topology.allSw();
    const fns = this.topology.allFunctions();
    return this.topology.allEcu().map((e) => ({
      ...e,
      sw: sw.filter((s) => s.ecuPno === e.ecuPno).map((s) => `${s.swId}@${s.version}`),
      features: new Set(fns.filter((f) => f.ecuPno === e.ecuPno).map((f) => f.featureId)).size,
    }));
  }

  sw(q: { ecuPno?: string; q?: string }) {
    const ecu = new Map(this.topology.allEcu().map((e) => [e.ecuPno, e]));
    const fns = this.topology.allFunctions();
    const needle = q.q?.toLowerCase();
    return this.topology
      .allSw()
      .filter((s) => (!q.ecuPno || s.ecuPno === q.ecuPno) && (!needle || `${s.swId} ${s.name} ${s.supplier}`.toLowerCase().includes(needle)))
      .map((s) => ({
        swId: s.swId,
        version: s.version,
        name: s.name,
        swType: s.swType,
        purpose: s.purpose,
        ecuPno: s.ecuPno,
        ecuName: ecu.get(s.ecuPno)?.name ?? null,
        supplier: s.supplier,
        safetyClass: s.safetyClass,
        securityClass: s.securityClass,
        lifecycle: s.lifecycle,
        artifactId: s.artifactId,
        checksum: s.checksum,
        features: [...new Set(fns.filter((f) => f.swId === s.swId && f.swVersion === s.version).map((f) => `${f.featureId}@${f.featureVersion}`))],
      }));
  }

  /** ECU → SW → Function → Feature 구조 */
  structure() {
    const fns = this.topology.allFunctions();
    const sw = this.topology.allSw();
    return this.topology.allEcu().map((e) => ({
      ecuPno: e.ecuPno,
      name: e.name,
      domain: e.domain,
      sw: sw
        .filter((s) => s.ecuPno === e.ecuPno)
        .map((s) => ({
          swId: s.swId,
          version: s.version,
          name: s.name,
          functions: fns.filter((f) => f.swId === s.swId && f.swVersion === s.version).map((f) => ({ functionId: f.functionId, name: f.name, featureId: f.featureId, featureVersion: f.featureVersion })),
        })),
    }));
  }

  /** UPG-VC → 지원 Feature(최신 Version)·Fleet 차량 */
  upg() {
    const feats = latest(this.features.all());
    const codes = new Set<string>([...feats.flatMap((f) => f.upgVc ?? []), ...this.fleet.vehicles().map((v) => v.upgVc)]);
    return [...codes].sort().map((upgVc) => ({
      upgVc,
      features: feats.filter((f) => (f.upgVc ?? []).includes(upgVc)).map((f) => ({ featureId: f.featureId, version: f.version, name: f.name, lifecycle: f.lifecycle })),
      vehicles: this.fleet.vehicles().filter((v) => v.upgVc === upgVc).map((v) => v.vin),
      models: [...new Set(feats.filter((f) => (f.upgVc ?? []).includes(upgVc)).map((f) => `${f.country}/${f.vehicleModel}/${f.trim}`))],
    }));
  }

  /** 제어점 — Feature(최신 Version)의 Control Point와 묶인 정책 flag. BD-06: 한 제어점에 배포 flag 하나 */
  controlPoints() {
    const pols = this.policies.all();
    return latest(this.features.all()).map((f) => {
      const mine = pols.filter((p) => p.featureId === f.featureId);
      const cps = f.controlPoints ?? [];
      return {
        featureId: f.featureId,
        version: f.version,
        name: f.name,
        lifecycle: f.lifecycle,
        controlPoints: cps,
        policies: mine.map((p) => ({ policyId: p.policyId, flagKey: p.flagKey, controlPoint: p.controlPoint, status: p.status, featureVersion: p.featureVersion })),
        unbound: cps.filter((cp) => !mine.some((p) => p.controlPoint === cp)),
        multiBound: cps.filter((cp) => mine.filter((p) => p.controlPoint === cp && p.status === 'DEPLOYED').length > 1),
      };
    });
  }

  /** Taxonomy — 태그별 Feature, 차종별 Feature 수 */
  taxonomy() {
    const feats = latest(this.features.all());
    const tags = [...new Set(feats.flatMap((f) => f.tags ?? []))].sort();
    return {
      tags: tags.map((tag) => ({ tag, features: feats.filter((f) => (f.tags ?? []).includes(tag)).map((f) => ({ featureId: f.featureId, version: f.version, name: f.name })) })),
      scopes: Object.entries(feats.reduce<Record<string, number>>((m, f) => ((m[`${f.country}/${f.vehicleModel}`] = (m[`${f.country}/${f.vehicleModel}`] ?? 0) + 1), m), {})).map(([scope, count]) => ({ scope, count })),
    };
  }

  /** 요구·안전 추적 — 요구사항 → Function → SW → ECU, Gate·Evidence, 안전 분류, 의존관계, Baseline·정책 */
  trace(featureId: string, version: string) {
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    const ecu = new Map(this.topology.allEcu().map((e) => [e.ecuPno, e]));
    const evid = new Map(this.gates.allEvidence().map((e) => [e.evidenceRef, e]));
    const latestGates = Object.values(this.gates.latest(featureId, version)).filter(Boolean);
    const p = this.safety.ensure(featureId, version);
    return {
      feature: { featureId, version, name: f.name, lifecycle: f.lifecycle, asil: f.asil, scope: `${f.country}/${f.vehicleModel}/${f.trim}` },
      requirements: (f.requirementIds ?? []).map((reqId) => ({ reqId })),
      functions: this.topology.functions(featureId, version).map((x) => ({ functionId: x.functionId, name: x.name, swId: x.swId, swVersion: x.swVersion, ecuPno: x.ecuPno, ecuName: ecu.get(x.ecuPno)?.name ?? null })),
      gates: latestGates
        .sort((a, b) => a!.gate.localeCompare(b!.gate, undefined, { numeric: true }))
        .map((g) => ({ gate: g!.gate, gateName: g!.gateName, status: g!.status, evidenceRef: g!.evidenceRef, judgedAt: g!.judgedAt, evidence: g!.evidenceRef ? evid.get(g!.evidenceRef)?.resultReason ?? null : null })),
      safety: { fClass: p.fClass, status: p.status, asilRef: p.asilRef, haraRef: p.haraRef, safetyGoalIds: p.safetyGoalIds, safeState: p.safeState },
      dependencies: this.topology.outgoing(featureId, version).map((d) => ({ dependencyId: d.dependencyId, type: d.type, target: `${d.targetFeatureId}@${d.targetVersion}` })),
      baseline: this.baselines.forVersion(featureId, version)?.baselineId ?? f.baselineId ?? null,
      policies: this.policies.all().filter((x) => x.featureId === featureId && x.featureVersion === version).map((x) => ({ policyId: x.policyId, flagKey: x.flagKey, status: x.status })),
    };
  }

  /** Evidence 원장 — Gate 판정과 Evidence(데이터셋 + 플랫폼에서 판정한 것) */
  evidence(q: { featureId?: string; gate?: string; result?: string }) {
    const gateBy = new Map(this.gates.all().map((g) => [g.gateRecordId, g]));
    return this.gates
      .allEvidence()
      .filter((e) => (!q.featureId || e.featureId === q.featureId) && (!q.gate || e.gate === q.gate) && (!q.result || e.inputResult === q.result))
      .map((e) => ({ evidenceRef: e.evidenceRef, gate: e.gate, gateRecordId: e.gateRecordId, featureId: e.featureId, featureVersion: e.featureVersion, featureName: e.featureName, owner: e.owner, inputResult: e.inputResult, resultReason: e.resultReason, gateStatus: gateBy.get(e.gateRecordId)?.status ?? null }));
  }

  /** 변경 이력(변경요청) — Version 변경 사유(데이터셋 Version_Rationale) */
  changes(featureId?: string) {
    return this.topology
      .allRationale()
      .filter((r) => !featureId || r.featureId === featureId)
      .map((r) => {
        const to = this.features.get(r.featureId, r.toVersion);
        return { featureId: r.featureId, name: to?.name ?? null, fromVersion: r.fromVersion, toVersion: r.toVersion, toBaselineId: r.toBaselineId, rationale: r.rationale, fromDescription: r.fromDescription, toDescription: r.toDescription, coreSw: `${r.fromCoreSwVersion ?? '—'} → ${r.toCoreSwVersion ?? '—'}`, lifecycle: to?.lifecycle ?? null };
      });
  }
}

@Controller('api')
export class MasterDataController {
  constructor(private readonly svc: MasterDataService) {}

  @Get('master/ecu')
  ecu() {
    return { items: this.svc.ecus() };
  }
  @Get('master/sw')
  sw(@Query('ecuPno') ecuPno?: string, @Query('q') q?: string) {
    return { items: this.svc.sw({ ecuPno, q }) };
  }
  @Get('master/structure')
  structure() {
    return { items: this.svc.structure() };
  }
  @Get('master/upg')
  upg() {
    return { items: this.svc.upg() };
  }
  @Get('master/control-points')
  controlPoints() {
    return { items: this.svc.controlPoints() };
  }
  @Get('master/taxonomy')
  taxonomy() {
    return this.svc.taxonomy();
  }
  @Get('trace/:id/:ver')
  trace(@Param('id') id: string, @Param('ver') ver: string) {
    return this.svc.trace(id, ver);
  }
  @Get('evidence')
  evidence(@Query('featureId') featureId?: string, @Query('gate') gate?: string, @Query('result') result?: string) {
    return { items: this.svc.evidence({ featureId, gate, result }) };
  }
  @Get('changes')
  changes(@Query('featureId') featureId?: string) {
    return { items: this.svc.changes(featureId) };
  }
}
