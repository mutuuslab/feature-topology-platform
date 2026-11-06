// IF-15 Data Lake 조회 어댑터 — FF가 Lake에서 읽는 것(80-75 8장 조회 API + TL-C01 확장)의 형식과 구현 선택.
// 경계(80-70 0장): Lake가 원천·집계·신선도·모델의 주인이고, FF는 읽기만 한다. 응답은 Lake 계약 그대로(snake_case)이고,
// FF 판정(4축·Canary 규칙 ①·점검 결과)은 도메인 서비스가 @ff/contracts 규칙으로 따로 한다 — 어댑터에 판단을 넣지 않는다.
//
// 구현: mock(이 프로세스 안의 결정적 Lake, adapters/lake/mock-lake.ts — 데이터셋·모델·예시는 data/fixtures/lake) · off(연결 없음).
// 실제 Lake(TL-X01)는 live 어댑터를 여기 붙인다: 5분마다 /v1/freshness·/v1/metrics/*를 당겨 캐시에 두고 같은 동기 인터페이스로 읽는다
// (80-75 8장 "5분 pull"). 그때 kernel/connections.ts의 datalake liveAdapter를 true로 바꾼다.
import { Inject, Injectable } from '@nestjs/common';
import { join } from 'node:path';
import type { CanaryMetric, Freshness, LakeDataCategory, ModelPurpose } from '@ff/contracts';
import { Clock } from '../../kernel/clock';
import { DB, type Db } from '../../kernel/db';
import { isProduction, seedOf } from '../../kernel/runtime-config';
import { MockLake } from './mock-lake';

type Env = Record<string, string | undefined>;

/** IF-15 Freshness(80-75 8장) */
export interface LakeFreshnessDoc {
  type: string;
  last_occurred_at: string | null;
  last_ingested_at: string | null;
  lag_seconds: number | null;
  sla_seconds: number;
  stale: boolean;
}

/** IF-15 Meta */
export interface LakeMetaDoc {
  as_of: string;
  label_watermark_seq: number;
  provisional: boolean;
  k_min: 5;
  freshness: LakeFreshnessDoc;
}

/** IF-15 Indicator */
export interface LakeIndicatorDoc {
  axis: 'OPERATION' | 'PROBLEM' | 'IMPROVEMENT' | 'RISK';
  name: string;
  current: number | null;
  previous: number | null;
  sample_vehicles: number | null;
  suppressed: boolean;
}

/** IF-15 FeatureHealthMetrics(GET /v1/metrics/feature-health) */
export interface LakeFeatureHealthDoc {
  meta: LakeMetaDoc;
  feature_id: string;
  feature_version: string | null;
  window: '1d' | '7d' | '28d';
  indicators: LakeIndicatorDoc[];
  /** TL-C01 확장 — 이 판을 쓰는 활성 차량 수(Lake 모집단 실측, 1일) */
  active_vehicles: number | null;
}

// ── TL-C01 확장: 80-75 OpenAPI에 아직 없는 조회(Lake 서버 v1 결정 U-1~U-19 뒤 계약에 넣는다) ──

export interface LakeDatasetDoc {
  dataset: string;
  title: string;
  owner: string;
  schema_version: string;
  category: LakeDataCategory;
  markets: string[];
  basis: 'LAW' | 'CONSENT' | 'CONTRACT';
  basis_note: string;
  retention: string;
  pseudonymization: string;
  quality: { missing_rate: number; duplicate_rate: number; range_violations: number };
  last_loaded_at: string | null;
  rows_last_load: number;
  freshness: LakeFreshnessDoc;
  transfer_hold: boolean;
}

export interface LakeModelDoc {
  model_id: string;
  version: string;
  purpose: ModelPurpose;
  title: string;
  technique: string;
  owner: string;
  lake_approved_by: string;
  trained_at: string;
  dataset_hash: string;
  metrics: { precision: number | null; recall: number | null; calibration: number | null; fairness_gap: number | null };
  drift: boolean;
  drift_note: string | null;
}

export interface LakeCanaryDoc {
  meta: LakeMetaDoc;
  policy_id: string;
  vehicles: { treatment: number; control: number };
  series: { start: string; treatment: Record<CanaryMetric, number>; control: Record<CanaryMetric, number> }[];
  /** 창 전체 사건 수(신뢰구간 계산용) */
  events: { treatment: Record<CanaryMetric, number>; control: Record<CanaryMetric, number> };
  /** 모델 ③ 점수 — Lake가 판마다 낸 그대로(어느 판을 쓸지는 FF 사용 승인이 정한다) */
  risks: { model_id: string; version: string; score: number; factors: { name: string; weight: number }[] }[];
}

export interface LakeExperimentDoc {
  experiment_id: string;
  metric: string;
  effect: number | null;
  ci: [number, number] | null;
  samples: { treatment: number; control: number };
  min_samples: number;
  freshness: LakeFreshnessDoc;
}

export interface LakeTrialDoc {
  freshness: LakeFreshnessDoc;
  usage: { band: string; vehicles: number; conversion: number }[];
  model: { model_id: string; version: string } | null;
  targets: { segment: string; vehicles: number; propensity: number }[];
  fairness: { group: string; rate: number; gap: number; pass: boolean }[];
}

export interface LakeAnomalyEvidenceDoc {
  anomaly_id: string;
  source: 'RULE' | 'MODEL';
  model: { model_id: string; version: string; score: number } | null;
  snapshot: { dataset: string; as_of: string; ref: string };
}

/** Lake가 받은 FF 이벤트 위치(GET /v1/ff/cursor) */
export interface LakeCursorDoc {
  last_seq: number;
  last_at: string | null;
}

/** FF가 Lake에서 읽는 것 — 동기(실제 연결은 당겨 온 캐시에서 읽는다) */
export interface LakeReader {
  freshness(): { as_of: string; label_watermark_seq: number; types: LakeFreshnessDoc[] };
  datasets(): LakeDatasetDoc[];
  models(): LakeModelDoc[];
  cursor(): LakeCursorDoc;
  featureHealth(featureId: string, version: string, market: string): LakeFeatureHealthDoc;
  canary(p: { policyId: string; flagKey: string; featureId: string; version: string; market: string; basisPoints: number }): LakeCanaryDoc;
  experiment(e: { experimentId: string; policyId: string; metric: string; minSamples: number; startedAt: string | null; treatmentBp: number }): LakeExperimentDoc;
  trials(): LakeTrialDoc;
  anomalyEvidence(a: { anomalyId: string; kind: string; featureId: string; at: string }): LakeAnomalyEvidenceDoc;
  /** 최근 24시간 조회 실패 수 */
  failures24h(): number;
}

export const LAKE_FIXTURES = join(__dirname, '..', '..', '..', '..', 'data', 'fixtures', 'lake');

/**
 * 연결 방식 — IF_MODE_15=off·FF_CONN_DATALAKE=off면 off. 운영 설치는 기본 off(모의를 실제처럼 쓰지 않는다 — 실제 어댑터 TL-X01 전까지).
 * 데모·개발은 모의(mock). live는 실제 어댑터가 없어 기본으로 내려간다.
 */
export function lakeMode(env: Env = process.env): 'mock' | 'off' {
  if (env.IF_MODE_15 === 'off' || env.FF_CONN_DATALAKE === 'off') return 'off';
  if (env.FF_CONN_DATALAKE === 'mock') return 'mock';
  return isProduction(env) ? 'off' : 'mock';
}

/** Lake 연결 — 화면·판정 서비스는 이것으로만 Lake를 읽는다(null = 연결 안 됨) */
@Injectable()
export class LakeLink {
  private mock: MockLake | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  mode(): 'mock' | 'off' {
    return lakeMode(process.env);
  }

  reader(): LakeReader | null {
    if (this.mode() === 'off') return null;
    // 시드 없는 설치(고객 첫 실행)는 그 고객의 Lake에 아직 아무것도 없다 — 빈 모의(외부 연계 sampleFixture와 같은 규칙)
    this.mock ??= new MockLake(this.db, this.clock, process.env.FF_LAKE_FIXTURES ?? LAKE_FIXTURES, seedOf(process.env) === 'none');
    return this.mock;
  }

  /** IF-15 신선도 → 화면 신선도 */
  static freshness(f: LakeFreshnessDoc | null | undefined, dataset?: string): Freshness {
    if (!f) return { dataset: dataset ?? '—', asOf: null, lagSeconds: null, slaSeconds: 600, stale: true };
    return { dataset: f.type, asOf: f.last_ingested_at, lagSeconds: f.lag_seconds, slaSeconds: f.sla_seconds, stale: f.stale };
  }
}
