// IF-15 모의 Data Lake — 실제 Lake 서버(80-75, TL-L*) 대신 이 프로세스 안에서 결정적으로 답한다.
// · 데이터셋(데이터 계약)·모델·예시 덮어쓰기는 data/fixtures/lake, 나머지 값은 Feature·정책 ID의 해시로 만든다(같은 입력 = 같은 값).
// · Lake가 아는 Feature·정책은 FF가 보낸 라벨이라는 가정으로 FF DB를 읽기만 한다 — 아무것도 쓰지 않는다.
// · 시간은 FF 시계 기준(지연 = 지금 − 마지막 적재). 시드 없는 설치는 빈 Lake(데이터셋·모델 없음).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANARY_METRICS, INDICATOR_RULES, LAKE_INDICATORS, type CanaryMetric, type LakeIndicatorName } from '@ff/contracts';
import type { Clock } from '../../kernel/clock';
import type { Db } from '../../kernel/db';
import type { LakeAnomalyEvidenceDoc, LakeCanaryDoc, LakeCursorDoc, LakeDatasetDoc, LakeExperimentDoc, LakeFeatureHealthDoc, LakeFreshnessDoc, LakeIndicatorDoc, LakeModelDoc, LakeReader, LakeTrialDoc } from './lake-reader';

interface DatasetFx {
  dataset: string; title: string; owner: string; schemaVersion: string; category: LakeDatasetDoc['category']; markets: string[];
  basis: LakeDatasetDoc['basis']; basisNote: string; retention: string; pseudonymization: string; slaSeconds: number; lagSeconds: number;
  quality: { missingRate: number; duplicateRate: number; rangeViolations: number }; rowsLastLoad: number; transferHold: boolean;
}
interface ModelFx {
  modelId: string; version: string; purpose: LakeModelDoc['purpose']; title: string; technique: string; owner: string; lakeApprovedBy: string;
  trainedAgoDays: number; datasetHash: string; metrics: { precision: number | null; recall: number | null; calibration: number | null; fairnessGap: number | null }; drift: boolean; driftNote: string | null;
}
type HealthOverride = Partial<Record<LakeIndicatorName, [number, number]>> & { _suppressed?: LakeIndicatorName[]; _sample?: number };
interface ScenarioFx {
  health?: Record<string, HealthOverride>;
  canary?: Record<string, Partial<Record<CanaryMetric, number>> & { vehicles?: number }>;
  trials?: { usage: LakeTrialDoc['usage']; targets: LakeTrialDoc['targets']; fairness: LakeTrialDoc['fairness'] };
}

const HOUR = 3600_000;
/** 0 이상 1 미만 — 같은 문자열이면 같은 값 */
export const unit = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0) / 2 ** 32;
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

/** 정상 범위 기본값 — 경계(contracts INDICATOR_RULES) 안쪽에서 해시로 */
const BASE: Record<LakeIndicatorName, (u: number) => number> = {
  delivery_success_rate: (u) => 0.984 + u * 0.013,
  status_rejected_rate: (u) => 0.0015 + u * 0.004,
  disabled_share: (u) => 0.004 + u * 0.02,
  dtc_vehicle_rate: (u) => 0.0011 + u * 0.0016,
  fault_rate_per_1k: (u) => 0.5 + u * 0.9,
  safety_event_rate_per_1k: (u) => 0.18 + u * 0.32,
  incident_count: (u) => Math.floor(u * 2),
  anomaly_open_count: (u) => Math.floor(u * 2),
  usage_rate: (u) => 0.44 + u * 0.36,
  manual_off_rate: (u) => 0.025 + u * 0.06,
  trial_conversion_rate: (u) => 0.1 + u * 0.12,
  security_alert_count: () => 0,
  data_missing_rate: (u) => 0.003 + u * 0.02,
};
const COUNTS = new Set<LakeIndicatorName>(['incident_count', 'anomaly_open_count', 'security_alert_count']);

/** Canary 기준 비율 — apply_failure_rate는 차량당 비율, 나머지는 1천 대당 */
const CANARY_BASE: Record<CanaryMetric, (u: number) => number> = {
  apply_failure_rate: (u) => 0.004 + u * 0.003,
  dtc_per_1k: (u) => 0.9 + u * 0.6,
  safety_event_per_1k: (u) => 0.25 + u * 0.2,
};
const perVehicle = (m: CanaryMetric) => (m === 'apply_failure_rate' ? 1 : 1000);

export class MockLake implements LakeReader {
  private fx: { datasets: DatasetFx[]; models: ModelFx[]; scenarios: ScenarioFx } | null = null;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly dir: string,
    private readonly empty: boolean,
  ) {}

  private load() {
    if (this.fx) return this.fx;
    const read = <T>(name: string): T => JSON.parse(readFileSync(join(this.dir, `${name}.json`), 'utf8'));
    this.fx = this.empty ? { datasets: [], models: [], scenarios: {} } : { datasets: read<DatasetFx[]>('datasets'), models: read<ModelFx[]>('models'), scenarios: read<ScenarioFx>('scenarios') };
    return this.fx;
  }

  private now() {
    return this.clock.now().getTime();
  }

  private fresh(d: DatasetFx): LakeFreshnessDoc {
    const ingested = this.now() - d.lagSeconds * 1000;
    return { type: d.dataset, last_occurred_at: new Date(ingested - 60_000).toISOString(), last_ingested_at: new Date(ingested).toISOString(), lag_seconds: d.lagSeconds, sla_seconds: d.slaSeconds, stale: d.lagSeconds > d.slaSeconds };
  }

  private dataset(name: string) {
    return this.load().datasets.find((d) => d.dataset === name) ?? null;
  }

  private meta(dataset: string): LakeFreshnessDoc | null {
    const d = this.dataset(dataset);
    return d ? this.fresh(d) : null;
  }

  private metaDoc(dataset: string) {
    const f = this.meta(dataset) ?? { type: dataset, last_occurred_at: null, last_ingested_at: null, lag_seconds: null, sla_seconds: 600, stale: true };
    return { as_of: new Date(this.now()).toISOString(), label_watermark_seq: this.cursor().last_seq, provisional: false, k_min: 5 as const, freshness: f };
  }

  datasets(): LakeDatasetDoc[] {
    return this.load().datasets.map((d) => {
      const f = this.fresh(d);
      return {
        dataset: d.dataset, title: d.title, owner: d.owner, schema_version: d.schemaVersion, category: d.category, markets: d.markets, basis: d.basis, basis_note: d.basisNote,
        retention: d.retention, pseudonymization: d.pseudonymization,
        quality: { missing_rate: d.quality.missingRate, duplicate_rate: d.quality.duplicateRate, range_violations: d.quality.rangeViolations },
        last_loaded_at: f.last_ingested_at, rows_last_load: d.rowsLastLoad, freshness: f, transfer_hold: d.transferHold,
      };
    });
  }

  freshness() {
    return { as_of: new Date(this.now()).toISOString(), label_watermark_seq: this.cursor().last_seq, types: this.load().datasets.map((d) => this.fresh(d)) };
  }

  models(): LakeModelDoc[] {
    return this.load().models.map((m) => ({
      model_id: m.modelId, version: m.version, purpose: m.purpose, title: m.title, technique: m.technique, owner: m.owner, lake_approved_by: m.lakeApprovedBy,
      trained_at: new Date(this.now() - m.trainedAgoDays * 24 * HOUR).toISOString(), dataset_hash: m.datasetHash,
      metrics: { precision: m.metrics.precision, recall: m.metrics.recall, calibration: m.metrics.calibration, fairness_gap: m.metrics.fairnessGap },
      drift: m.drift, drift_note: m.driftNote,
    }));
  }

  /** Lake가 받은 FF 이벤트 위치 — 모의 Lake는 마지막 3건을 아직 적재 중으로 둔다(라벨 지연 표시) */
  cursor(): LakeCursorDoc {
    const max = this.db.get<{ seq: number | null }>('SELECT max(seq) AS seq FROM events')?.seq ?? 0;
    const seq = Math.max(0, max - 3);
    const at = seq ? this.db.get<{ at: string }>('SELECT at FROM events WHERE seq <= ? ORDER BY seq DESC LIMIT 1', seq)?.at ?? null : null;
    return { last_seq: seq, last_at: at };
  }

  /** 판 하나의 활성 차량(Lake 모집단 실측) — 1만 2천 ~ 47만 대 */
  private active(featureId: string, version: string) {
    return Math.round((12_000 + unit(`${featureId}@${version}:pop`) * 460_000) / 10) * 10;
  }

  featureHealth(featureId: string, version: string, market: string): LakeFeatureHealthDoc {
    const key = `${featureId}@${version}`;
    const sc = this.load().scenarios.health?.[key] ?? {};
    const active = this.empty ? null : this.active(featureId, version);
    const sample = sc._sample ?? active;
    const indicators: LakeIndicatorDoc[] = LAKE_INDICATORS.map((name) => {
      const o = sc[name];
      const u = unit(`${key}:${name}`);
      const cur = o ? o[0] : BASE[name](u);
      const prev = o ? o[1] : COUNTS.has(name) ? BASE[name](unit(`${key}:${name}:prev`)) : cur * (0.94 + unit(`${key}:${name}:prev`) * 0.12);
      const suppressed = !!sc._suppressed?.includes(name);
      const d = COUNTS.has(name) ? 0 : 5;
      return { axis: INDICATOR_RULES[name].axis, name, current: suppressed || this.empty ? null : round(cur, d), previous: suppressed || this.empty ? null : round(prev, d), sample_vehicles: suppressed ? null : sample, suppressed };
    });
    return { meta: this.metaDoc(market === 'CN' ? 'cn.gold.feature_health_1d' : 'gold.feature_health_1d'), feature_id: featureId, feature_version: version, window: '1d', indicators, active_vehicles: active };
  }

  canary(p: { policyId: string; flagKey: string; featureId: string; version: string; market: string; basisPoints: number }): LakeCanaryDoc {
    const sc = this.load().scenarios.canary?.[p.flagKey] ?? {};
    const active = this.active(p.featureId, p.version);
    const treatment = sc.vehicles ?? Math.max(0, Math.round((active * Math.min(10_000, p.basisPoints)) / 10_000));
    const control = Math.min(60_000, Math.round(active * 0.5));
    const meta = this.metaDoc(`gold.canary_5m_${p.market.toLowerCase()}`);
    const end = Date.parse(meta.freshness.last_ingested_at ?? new Date(this.now()).toISOString());
    const factor = (m: CanaryMetric) => sc[m] ?? 1 + (unit(`${p.flagKey}:${m}:rr`) - 0.5) * 0.1;
    const base = (m: CanaryMetric) => CANARY_BASE[m](unit(`${p.featureId}:${m}`));
    const series = Array.from({ length: 24 }, (_, i) => {
      const at = new Date(end - (23 - i) * HOUR).toISOString();
      const c = {} as Record<CanaryMetric, number>;
      const t = {} as Record<CanaryMetric, number>;
      for (const m of CANARY_METRICS) {
        c[m] = round(base(m) * (1 + (unit(`${p.policyId}:${m}:${i}:c`) - 0.5) * 0.16), 5);
        t[m] = round(c[m] * factor(m) * (1 + (unit(`${p.policyId}:${m}:${i}:t`) - 0.5) * 0.1), 5);
      }
      return { start: at, treatment: t, control: c };
    });
    const events = { treatment: {} as Record<CanaryMetric, number>, control: {} as Record<CanaryMetric, number> };
    // 창 전체 사건 수 — 적용 실패는 차량당 비율 × 차량 수, 나머지는 시간당 1천 대당 비율의 합 × 차량 수 / 1천
    for (const m of CANARY_METRICS) {
      const sum = (arm: 'treatment' | 'control') => series.reduce((s, x) => s + x[arm][m], 0);
      const scale = m === 'apply_failure_rate' ? 1 / series.length : 1 / perVehicle(m);
      events.treatment[m] = Math.round(sum('treatment') * treatment * scale);
      events.control[m] = Math.round(sum('control') * control * scale);
    }
    return { meta, policy_id: p.policyId, vehicles: { treatment, control }, series, events, risks: this.risks(p.flagKey, sc) };
  }

  /** 모델 ③ 점수 — 판마다(같은 입력이면 판끼리 조금 다르다) */
  private risks(flagKey: string, sc: Partial<Record<CanaryMetric, number>>) {
    const hot = Object.values(sc).some((v) => typeof v === 'number' && v >= 1.5);
    return this.load().models.filter((m) => m.purpose === 'DEPLOY_RISK').map((m) => {
      const u = unit(`${flagKey}:${m.version}:risk`);
      const score = round(Math.min(0.97, (hot ? 0.62 : 0.08) + u * 0.22), 2);
      const factors = hot
        ? [{ name: 'Canary 24시간 DTC 증가', weight: 0.41 }, { name: '대상 SW 조합 편차', weight: 0.22 }, { name: 'ASIL·F등급', weight: 0.14 }, { name: '과거 롤백 이력', weight: 0.08 }]
        : [{ name: 'ASIL·F등급', weight: round(0.12 + u * 0.1, 2) }, { name: '대상 차종 분포', weight: 0.07 }, { name: '과거 롤백 이력', weight: 0.04 }];
      return { model_id: m.modelId, version: m.version, score, factors };
    });
  }

  experiment(e: { experimentId: string; policyId: string; metric: string; minSamples: number; startedAt: string | null; treatmentBp: number }): LakeExperimentDoc {
    const f = this.meta('gold.feature_usage_1d');
    const days = e.startedAt ? Math.max(0, (this.now() - Date.parse(e.startedAt)) / (24 * HOUR)) : 0;
    const total = Math.floor(days * 2600);
    const treatment = Math.floor((total * e.treatmentBp) / 10_000);
    const control = total - treatment;
    const u = unit(`${e.experimentId}:${e.policyId}:lake`);
    const p = 0.05;
    const effect = treatment && control ? round((u - 0.45) * 0.03, 4) : null;
    const half = treatment && control ? round(1.96 * Math.sqrt((p * (1 - p)) / treatment + (p * (1 - p)) / control), 4) : null;
    return {
      experiment_id: e.experimentId, metric: e.metric, effect, ci: effect != null && half != null ? [round(effect - half, 4), round(effect + half, 4)] : null,
      samples: { treatment, control }, min_samples: e.minSamples,
      freshness: f ?? { type: 'gold.feature_usage_1d', last_occurred_at: null, last_ingested_at: null, lag_seconds: null, sla_seconds: 86_400, stale: true },
    };
  }

  trials(): LakeTrialDoc {
    const t = this.load().scenarios.trials;
    const model = this.load().models.find((m) => m.purpose === 'TRIAL_PROPENSITY');
    return {
      freshness: this.meta('gold.trial_conversion_1d') ?? { type: 'gold.trial_conversion_1d', last_occurred_at: null, last_ingested_at: null, lag_seconds: null, sla_seconds: 86_400, stale: true },
      usage: t?.usage ?? [], model: model ? { model_id: model.modelId, version: model.version } : null, targets: t?.targets ?? [], fairness: t?.fairness ?? [],
    };
  }

  anomalyEvidence(a: { anomalyId: string; kind: string; featureId: string; at: string }): LakeAnomalyEvidenceDoc {
    const model = this.load().models.find((m) => m.purpose === 'ANOMALY' && !m.drift);
    const dataset = a.kind === 'SECURITY' ? 'stream.security_ids' : a.kind === 'DELIVERY' ? 'gold.delivery_1h' : 'stream.safety_events';
    const ref = `SNAP-${createHash('sha256').update(a.anomalyId).digest('hex').slice(0, 10)}`;
    const byModel = a.kind === 'FEATURE_FAULT' && !!model;
    return {
      anomaly_id: a.anomalyId, source: byModel ? 'MODEL' : 'RULE',
      model: byModel ? { model_id: model!.modelId, version: model!.version, score: round(0.62 + unit(`${a.anomalyId}:score`) * 0.33, 2) } : null,
      snapshot: { dataset, as_of: a.at, ref },
    };
  }

  failures24h(): number {
    return 0;
  }
}
