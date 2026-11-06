// Data Lake 실측을 기존 화면에 붙이는 조회(IF-15, 80-70 6장 5·7·8 — BACKLOG TL-UI05·UI07·UI08).
// 컴포넌트마다 서비스 하나: 이상 징후 출처·증거(D06-12), 실험 실측 효과(D01-07), 체험 전환 분석(D05-06). 판단은 바꾸지 않고 근거만 더한다.
import { Controller, Get, Inject, Injectable } from '@nestjs/common';
import { modelUsable, type Experiment, type LakeAnomalyEvidence, type LakeExperimentEffect, type LakeTrialInsight } from '@ff/contracts';
import { modelUseOf } from '../adapters/lake/ff-lake-records';
import { LakeLink } from '../adapters/lake/lake-reader';
import { Clock } from '../kernel/clock';
import { PlatformComponent } from '../kernel/components';
import { DB, type Db } from '../kernel/db';
import { LakeIntegrationService } from './d05-ext/api-gateway/lake/lake-integration.service';

/** 사람 판정이 끝난 이상 건 — 판정은 재학습 라벨로 Lake에 간다 */
const JUDGED = new Set(['ACKNOWLEDGED', 'MITIGATED', 'DISMISSED']);

@Injectable()
@PlatformComponent('D06-12')
export class AnomalyLakeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly lake: LakeLink,
  ) {}

  /** 이상 건마다 출처(규칙 ①·모델 ②)·Lake 증거 스냅샷·판정 라벨 */
  evidence(): { connected: boolean; items: LakeAnomalyEvidence[] } {
    const reader = this.lake.reader();
    if (!reader) return { connected: false, items: [] };
    const cursor = reader.cursor().last_seq;
    const rows = this.db.all<{ anomaly_id: string; kind: string; feature_id: string; status: string; doc: string }>('SELECT anomaly_id, kind, feature_id, status, doc FROM anomaly ORDER BY anomaly_id DESC');
    const models = reader.models();
    return {
      connected: true,
      items: rows.map((r) => {
        const a = JSON.parse(r.doc) as { openedAt?: string; createdAt?: string; updatedAt?: string };
        const at = a.openedAt ?? a.createdAt ?? a.updatedAt ?? '';
        const e = reader.anomalyEvidence({ anomalyId: r.anomaly_id, kind: r.kind, featureId: r.feature_id, at });
        const m = e.model ? models.find((x) => x.model_id === e.model!.model_id && x.version === e.model!.version) : undefined;
        const usable = e.model ? modelUsable({ use: modelUseOf(this.db, e.model.model_id, e.model.version).use, drift: !!m?.drift }) : false;
        // 판정 이벤트가 Lake 위치보다 앞이면 보냄, 아직 뒤면 보내는 중
        const judged = this.db.get<{ seq: number }>("SELECT max(seq) AS seq FROM events WHERE aggregate = ? AND type LIKE 'anomaly.%'", r.anomaly_id)?.seq ?? null;
        const label = !JUDGED.has(r.status) ? 'NONE' : judged != null && judged <= cursor ? 'SENT' : 'PENDING';
        return { anomalyId: r.anomaly_id, source: e.source, model: e.model ? { modelId: e.model.model_id, version: e.model.version, score: e.model.score, usable } : null, snapshot: { dataset: e.snapshot.dataset, asOf: e.snapshot.as_of, ref: e.snapshot.ref }, label };
      }),
    };
  }
}

@Injectable()
@PlatformComponent('D01-07')
export class ExperimentLakeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly lake: LakeLink,
  ) {}

  /** 실측 효과 — 표본이 최소 표본에 못 미치면 판단 불가 */
  effects(): { connected: boolean; items: LakeExperimentEffect[] } {
    const reader = this.lake.reader();
    if (!reader) return { connected: false, items: [] };
    const rows = this.db.all<{ doc: string }>('SELECT doc FROM experiment ORDER BY experiment_id').map((r) => JSON.parse(r.doc) as Experiment);
    return {
      connected: true,
      items: rows.map((e) => {
        const d = reader.experiment({ experimentId: e.experimentId, policyId: e.policyId, metric: e.metric, minSamples: e.minSamples, startedAt: e.startedAt, treatmentBp: e.treatmentBp });
        return { experimentId: e.experimentId, metric: d.metric, effect: d.effect, ci: d.ci, samples: d.samples, decidable: Math.min(d.samples.treatment, d.samples.control) >= d.min_samples && !d.freshness.stale, freshness: LakeLink.freshness(d.freshness) };
      }),
    };
  }
}

@Injectable()
@PlatformComponent('D05-06')
export class TrialLakeService {
  constructor(
    private readonly lake: LakeLink,
    private readonly link: LakeIntegrationService,
    private readonly clock: Clock,
  ) {}

  /** 실사용일과 구매 전환, 모델 ④ 추천 대상(공정성 점검) — 모델이 사용 승인 전이면 추천 대상은 보이지 않는다 */
  insight(): LakeTrialInsight {
    const reader = this.lake.reader();
    if (!reader) return { connected: false, asOf: null, freshness: LakeLink.freshness(null, 'gold.trial_conversion_1d'), usage: [], model: null, targets: [], fairness: [] };
    const t = reader.trials();
    const model = t.model ? this.link.models().items.find((m) => m.modelId === t.model!.model_id && m.version === t.model!.version) ?? null : null;
    return { connected: true, asOf: this.clock.iso(), freshness: LakeLink.freshness(t.freshness), usage: t.usage, model, targets: model?.usable ? t.targets : [], fairness: t.fairness };
  }
}

@Controller('api/lake')
export class LakeInsightsController {
  constructor(
    private readonly anomalies: AnomalyLakeService,
    private readonly experiments: ExperimentLakeService,
    private readonly trials: TrialLakeService,
  ) {}

  @Get('anomaly-evidence')
  anomalyEvidence() {
    return this.anomalies.evidence();
  }

  @Get('experiments')
  experimentEffects() {
    return this.experiments.effects();
  }

  @Get('trials')
  trialInsight() {
    return this.trials.insight();
  }
}
