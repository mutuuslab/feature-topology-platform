// 재-HARA 자동 검출 (D06-05 변경 영향 검증, 보고서 v1.1 6.4 · FFG-LCY-003) — 플랫폼 이벤트(Version·안전 분류·Topology·이상 징후·
// 가상검증)를 받아 contracts reharaFindings로 6조건을 판정하고, 해당하면 그 Feature Version에 재-HARA 요청을 연다(Safety Manager 알림
// 이벤트 rehara.requested). 열린 요청은 G3 이후 Gate PASS를 막고(gate.service), G2 재판정 PASS가 닫는다.
import { Controller, Get, Inject, Injectable, OnModuleInit, Query } from '@nestjs/common';
import { REHARA_LABEL, reharaFindings, type ReharaChange, type SafetyProfile } from '@ff/contracts';
import type { Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { EventService } from '../../../kernel/event.service';
import { SafetyProfileService } from '../../d01-policy/registry/safety-profile.service';
import { FeatureRepo, TopologyRepo } from '../../d01-policy/repos';
import { ReharaRepo } from '../../d01-policy/topology/rehara.repo';
import { VirtualRunRepo } from '../scenario-validation/virtual-run.repo';

const SYSTEM: Actor = { id: 'system', role: 'SYSTEM', correlationId: 'rehara-detector' };
const EVENTS = ['feature.version.created', 'feature.updated', 'safety.profile.updated', 'dependency.created', 'anomaly.opened', 'virtual.validation.completed'];

@Injectable()
@PlatformComponent('D06-05')
export class ReharaService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly events: EventService,
    private readonly audit: AuditService,
    private readonly repo: ReharaRepo,
    private readonly features: FeatureRepo,
    private readonly topology: TopologyRepo,
    private readonly profiles: SafetyProfileService,
    private readonly runs: VirtualRunRepo,
  ) {}

  onModuleInit() {
    this.events.stream(EVENTS).subscribe((e) => this.on(e.type, e.aggregate, e.payload as Record<string, any>));
  }

  /** 이벤트 → (Feature, Version, 변경) 목록 → 조건 판정 → 요청 */
  on(type: string, target: string, p: Record<string, any>) {
    for (const [featureId, version, change] of this.changes(type, p)) {
      for (const f of reharaFindings(change)) this.open(featureId, version, f.condition, f.detail, f.ref, { event: type, target });
    }
  }

  private changes(type: string, p: Record<string, any>): [string, string, ReharaChange][] {
    if (type === 'feature.version.created' || type === 'feature.updated' || type === 'safety.profile.updated') {
      const versions = this.features.versions(p.featureId);
      const i = versions.findIndex((v) => v.version === p.version);
      if (i <= 0) return []; // 첫 Version — 비교할 기존 HARA 경계 없음
      const [b, a] = [versions[i - 1], versions[i]];
      const prof = (v: string) => this.profiles.list(p.featureId).find((x) => x.version === v) ?? null;
      return [[a.featureId, a.version, { kind: 'VERSION', before: { feature: b, profile: prof(b.version) }, after: { feature: a, profile: prof(a.version) } }]];
    }
    if (type === 'dependency.created') {
      const d = this.topology.get(p.dependencyId);
      if (!d) return [];
      const change: ReharaChange = { kind: 'DEPENDENCY', dependency: d };
      const tgt = d.targetVersion ?? this.features.versions(d.targetFeatureId).at(-1)?.version;
      return [[d.sourceFeatureId, d.sourceVersion, change], ...(tgt ? [[d.targetFeatureId, tgt, change] as [string, string, ReharaChange]] : [])];
    }
    if (type === 'anomaly.opened' && p.featureId) {
      const v = this.features.versions(p.featureId).at(-1);
      return v ? [[v.featureId, v.version, { kind: 'ANOMALY', anomalyId: p.anomalyId, anomalyKind: p.kind }]] : [];
    }
    if (type === 'virtual.validation.completed') {
      const run = this.runs.get(p.runId);
      if (!run || run.source !== 'vecu') return [];
      const prev = this.runs
        .list({ featureId: run.featureId, featureVersion: run.featureVersion })
        .filter((r) => r.source === 'vecu' && r.scenarioId === run.scenarioId && r.runId < run.runId)
        .sort((a, b) => b.runId.localeCompare(a.runId))[0];
      if (!prev) return [];
      const ads = (this.profiles.list(run.featureId).find((x) => x.version === run.featureVersion) as SafetyProfile | undefined)?.adsFeature ?? false;
      const limits = (r: typeof run) => Object.fromEntries(r.criteria.map((c) => [c.id, c.limit]));
      return [[run.featureId, run.featureVersion, { kind: 'TOOL', adsFeature: ads, from: { tool: prev.simulator, limits: limits(prev) }, to: { tool: run.simulator, limits: limits(run) } }]];
    }
    return [];
  }

  private open(featureId: string, featureVersion: string, condition: ReturnType<typeof reharaFindings>[number]['condition'], detail: string, ref: string, source: { event: string; target: string }) {
    this.db.tx(() => {
      const r = this.repo.insert({ featureId, featureVersion, condition, detail, ref, source, status: 'OPEN', createdAt: this.clock.iso(), resolvedAt: null, resolvedBy: null });
      if (!r) return;
      this.audit.record(SYSTEM, 'REHARA_REQUEST', `${featureId}@${featureVersion}`, { after: { requestId: r.requestId, condition, detail, source }, reason: REHARA_LABEL[condition], componentId: 'D06-05' });
      // Safety Manager 알림 — 운영 알림함·이벤트 화면이 받는다
      this.events.publish('rehara.requested', `${featureId}@${featureVersion}`, { requestId: r.requestId, featureId, featureVersion, condition, detail, notify: 'SAFETY_OFFICER' }, { componentId: 'D06-05' });
    });
  }

  list(q: { featureId?: string; featureVersion?: string; status?: string }) {
    return this.repo.list(q);
  }
}

@Controller('api')
export class ReharaController {
  constructor(private readonly rehara: ReharaService) {}

  @Get('rehara-requests')
  list(@Query('featureId') featureId?: string, @Query('featureVersion') featureVersion?: string, @Query('status') status?: string) {
    return { items: this.rehara.list({ featureId, featureVersion, status }) };
  }
}
