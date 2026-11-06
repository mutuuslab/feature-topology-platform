// Data Lake 연계·Closed loop 모듈(80-70, BACKLOG TL-*) — IF-15로 Lake를 읽고(adapters/lake), FF가 주인인 판정·점검 결과·수집 정책·모델 사용 승인을 둔다.
// 의존 방향: 이 모듈 → D01(Feature·정책 읽기) · 커널(LakeLink). Canary·중단 기준은 단계 확대와 한 판정이라 D01에 있다(staged-rollout/canary.service).
import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CollectionPolicyRow, FindingStatus } from '@ff/contracts';
import { LAKE_FIXTURES, LakeLink } from '../adapters/lake/lake-reader';
import { Clock } from '../kernel/clock';
import { DB, type Db } from '../kernel/db';
import { demoActivityEnabled } from '../demo-activity/demo-activity.seeder';
import { D01PolicyModule } from './d01-policy/d01-policy.module';
import { PolicyRepo } from './d01-policy/policy-repos';
import { CollectionPolicyController, CollectionPolicyService } from './d04-ops/telemetry-ingest/collection-policy.service';
import { FeatureHealthController, FeatureHealthService, FindingRepo } from './d04-ops/telemetry-ingest/feature-health.service';
import { LakeIntegrationController, LakeIntegrationService } from './d05-ext/api-gateway/lake/lake-integration.service';
import { AnomalyLakeService, ExperimentLakeService, LakeInsightsController, TrialLakeService } from './lake-insights.service';

export const LAKE_DEMO_META = 'seed-lake';
const DAY = 86_400_000;

interface FfDemo {
  collection: (Omit<CollectionPolicyRow, 'updatedAt' | 'publicationId'> & { days: number })[];
  findings: Parameters<FeatureHealthService['seedFinding']>[0][];
  approvals: [string, string, string, string, number][];
  abortCriteria: string[];
}

/** 시작 — 데모 활동 시드가 켜져 있으면 FF가 주인인 데모 기록을 한 번 넣고(ff-demo.json), 4축 판정을 한 번 돌린다 */
@Injectable()
export class LakeLoopBootstrap implements OnApplicationBootstrap {
  private readonly log = new Logger('LakeLoop');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly lake: LakeLink,
    private readonly health: FeatureHealthService,
    private readonly collection: CollectionPolicyService,
    private readonly policies: PolicyRepo,
    private readonly clock: Clock,
  ) {}

  onApplicationBootstrap() {
    if (!this.lake.reader()) return;
    if (demoActivityEnabled() && !this.db.get('SELECT value FROM meta WHERE key = ?', LAKE_DEMO_META)) this.seed();
    const n = this.health.refresh();
    if (n) this.log.log(`4축 판정 — 점검 결과 ${n}건 감지`);
  }

  private seed() {
    const demo = JSON.parse(readFileSync(join(process.env.FF_LAKE_FIXTURES ?? LAKE_FIXTURES, 'ff-demo.json'), 'utf8')) as FfDemo;
    const at = (days: number) => new Date(this.clock.now().getTime() - days * DAY).toISOString();
    this.db.tx(() => {
      for (const f of demo.findings) this.health.seedFinding({ ...f, status: f.status as FindingStatus });
      for (const { days, ...c } of demo.collection) this.collection.save({ ...c, publicationId: null, updatedAt: at(days) });
      for (const [modelId, version, by, role, days] of demo.approvals)
        this.db.run('INSERT INTO lake_model_use (model_id, version, decided_by, role, decision, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING', modelId, version, by, role, 'APPROVE', '모델 카드·평가·공정성 확인', at(days));
      for (const flag of demo.abortCriteria) {
        const p = this.policies.deployed(flag);
        if (!p) continue;
        const c = { policyId: p.policyId, metrics: [{ metric: 'apply_failure_rate', maxRelativeRisk: 1.5 }, { metric: 'dtc_per_1k', maxRelativeRisk: 1.5 }, { metric: 'safety_event_per_1k', maxRelativeRisk: 1.3 }], confidence: 0.95, observeHours: 24, maxLagMinutes: 10, registeredBy: 'usr-coordinator', registeredAt: at(3) };
        this.db.run('INSERT INTO policy_abort_criteria (policy_id, doc, registered_by, registered_at) VALUES (?, ?, ?, ?)', p.policyId, JSON.stringify(c), c.registeredBy, c.registeredAt);
      }
      this.db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', LAKE_DEMO_META, JSON.stringify({ at: this.clock.iso() }));
    });
  }
}

@Module({
  imports: [D01PolicyModule],
  controllers: [FeatureHealthController, CollectionPolicyController, LakeIntegrationController, LakeInsightsController],
  providers: [FindingRepo, FeatureHealthService, CollectionPolicyService, LakeIntegrationService, AnomalyLakeService, ExperimentLakeService, TrialLakeService, LakeLoopBootstrap],
  exports: [FeatureHealthService],
})
export class LakeLoopModule {}
