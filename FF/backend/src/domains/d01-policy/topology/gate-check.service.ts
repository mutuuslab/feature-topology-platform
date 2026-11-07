// Gate 자동 검사의 사실 모으기(P10, D01-02) — 판정은 contracts rules/gate-checks.ts 하나. 여기서는 읽기만 한다.
// Lifecycle 전이(정의 승인·검증 완료·출시)와 Gate 탭 조회가 같은 결과를 쓴다.
import { Inject, Injectable } from '@nestjs/common';
import { featureTraceCoverage, gateChecks, securityRelevance, NOTIFICATION_RULE_SPECS, OPS_ALERT_EVENTS, type FeatureVersionRow, type GateCheck, type GateCheckFacts, type GateCheckPolicy, type Policy } from '@ff/contracts';
import { lakeMode } from '../../../adapters/lake/lake-reader';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { PolicyRepo } from '../policy-repos';
import { FeatureRepo, TopologyRepo } from '../repos';
import { TraceLinkRepo } from '../registry/trace-link.repo';
import { AnalysisEvidenceService } from './analysis-evidence.service';

const STATUS_RANK: Record<string, number> = { DEPLOYED: 5, APPROVED: 4, VALIDATED: 3, DRAFT: 2, REJECTED: 1, RETIRED: 0 };

@Injectable()
@PlatformComponent('D01-02')
export class GateCheckService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
    private readonly topology: TopologyRepo,
    private readonly policies: PolicyRepo,
    private readonly traces: TraceLinkRepo,
    private readonly analysis: AnalysisEvidenceService,
  ) {}

  /** Control Point별 대표 정책 — 배포·승인된 것을 먼저, 같으면 늦은 개정(퇴역 정책은 빼고) */
  private policiesOf(f: FeatureVersionRow): Policy[] {
    const best = new Map<string, Policy>();
    for (const p of this.policies.forFeature(f.featureId, f.version)) {
      if (p.status === 'RETIRED') continue;
      const cur = best.get(p.controlPoint);
      if (!cur || STATUS_RANK[p.status] > STATUS_RANK[cur.status] || (STATUS_RANK[p.status] === STATUS_RANK[cur.status] && p.policyId > cur.policyId)) best.set(p.controlPoint, p);
    }
    return [...best.values()].sort((a, b) => a.policyId.localeCompare(b.policyId));
  }

  facts(f: FeatureVersionRow): GateCheckFacts {
    const requires = this.topology
      .outgoing(f.featureId, f.version)
      .filter((d) => d.type === 'REQUIRES')
      .map((d) => ({ dependencyId: d.dependencyId, targetFeatureId: d.targetFeatureId, targetVersion: d.targetVersion, targetLifecycle: d.targetVersion ? (this.features.get(d.targetFeatureId, d.targetVersion)?.lifecycle ?? null) : null }));
    const cov = featureTraceCoverage(this.traces.list({ featureId: f.featureId }), this.traces.evidence({ featureId: f.featureId }), []);
    const latest = this.analysis.latest(f.featureId, f.version);
    // 읽기만 — 분류(Safety Profile)가 아직 없으면 보안 무관으로 본다(조회가 초안을 만들지 않게)
    const prof = this.db.get<{ doc: string }>('SELECT doc FROM safety_profile WHERE feature_id = ? AND version = ?', f.featureId, f.version);
    const securityRelevant = prof ? securityRelevance(JSON.parse(prof.doc)).relevant : false;
    const pols = this.policiesOf(f);
    const policies: GateCheckPolicy[] = pols.map((p) => ({ policyId: p.policyId, flagKey: p.flagKey, status: p.status, safeDefault: p.safeDefault, rolloutMode: p.rollout.mode }));
    const flagRows = pols.length
      ? this.db.all<{ flag_key: string; retired_at: string | null }>(`SELECT flag_key, retired_at FROM flag_registry WHERE flag_key IN (${pols.map(() => '?').join(',')})`, ...pols.map((p) => p.flagKey))
      : [];
    const flags = pols.map((p) => {
      const r = flagRows.find((x) => x.flag_key === p.flagKey);
      return { flagKey: p.flagKey, bound: !!r, retired: !!r?.retired_at };
    });
    const priorReleased =
      this.features
        .versions(f.featureId)
        .filter((v) => v.version !== f.version && (v.lifecycle === 'RELEASED' || v.lifecycle === 'DEPRECATED'))
        .map((v) => v.version)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] ?? null;
    // 대상 'FEAT-x' · 'FEAT-x@버전…' · 'FEAT-x:…' — 범위 비교로 audit_target 색인을 쓴다('@' 다음 'A', ':' 다음 ';')
    const id = f.featureId;
    const auditEntries = this.db.get<{ n: number }>('SELECT count(*) AS n FROM audit WHERE target = ? OR (target >= ? AND target < ?) OR (target >= ? AND target < ?)', id, `${id}@`, `${id}A`, `${id}:`, `${id};`)?.n ?? 0;
    const alertRules = OPS_ALERT_EVENTS.map((event) => {
      const spec = NOTIFICATION_RULE_SPECS.find((r) => r.event === event);
      const added = this.db.get<{ n: number }>('SELECT count(*) AS n FROM notification_rule_recipient WHERE event_type = ?', event)?.n ?? 0;
      return { event, name: spec?.name ?? event, recipients: (spec?.recipients.length ?? 0) + added };
    });
    return {
      ownerId: f.ownerId ?? '',
      asil: f.asil,
      requires,
      variant: { country: f.country, vehicleModel: f.vehicleModel, trim: f.trim, upgVc: f.upgVc },
      tests: { required: cov.test.required, withEvidence: cov.test.withEvidence, missing: cov.test.missing },
      analysis: { hara: !!latest.HARA, tara: !!latest.TARA, securityRelevant },
      controlPoints: f.controlPoints.length,
      swCount: f.swIds.length,
      policies,
      flags,
      priorReleased,
      telemetry: { connected: lakeMode(process.env) !== 'off' },
      auditEntries,
      alertRules,
    };
  }

  checks(f: FeatureVersionRow): GateCheck[] {
    return gateChecks(this.facts(f));
  }
}
