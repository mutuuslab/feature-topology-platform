// 운영 지표 카탈로그 (Grafana 연동, 80-80) — 백엔드 /api/health/metrics·Data Lake /metrics·시연 시계열 생성기·대시보드·경보가 같은 이름을 쓴다.
// 라벨은 국가·차종·SW·Feature·Flag·결과만. VIN·가명·사람 ID는 라벨로 쓰지 않는다(카디널리티·개인정보).
// 이 파일은 import 없이 둔다 — tools/grafana(타입 스트리핑)가 경로로 바로 읽는다.

export type TelemetryMetricType = 'counter' | 'gauge' | 'histogram';
/** platform: FF 백엔드가 낸다 · lake: Data Lake 서버 /metrics(IF-15, TL-L01)가 낸다 — 시연에서는 생성기가 둘 다 흉내 낸다 */
export type MetricSource = 'platform' | 'lake';

export interface TelemetryMetricDef {
  name: string;
  type: TelemetryMetricType;
  help: string;
  labels: readonly string[];
  source: MetricSource;
  /** histogram 경계(초) */
  buckets?: readonly number[];
}

/** 차량 반영 지연 경계(초) — 즉시(DC0)부터 다음 시동 대기(DC3)까지 */
export const APPLY_LATENCY_BUCKETS = [1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, 21600] as const;
/** HTTP·Edge 처리 시간 경계(초) — observability.ts Metrics.BUCKETS와 같다 */
export const HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

/** 지표 하나가 가질 수 있는 시계열 수 상한 — 넘는 라벨 조합은 모두 "_other"로 합친다 */
export const METRIC_SERIES_LIMIT = 500;
export const OTHER_LABEL = '_other';

const VEHICLE = ['country', 'vehicle_model'] as const;
const FEATURE = ['feature', 'feature_version', 'country', 'vehicle_model', 'cohort'] as const;

export const TELEMETRY_METRICS: readonly TelemetryMetricDef[] = [
  // ── 플랫폼 HTTP·프로세스(기존) ──
  { name: 'ff_http_requests_total', type: 'counter', help: 'HTTP 요청 수', labels: ['method', 'route', 'status'], source: 'platform' },
  { name: 'ff_http_request_duration_seconds', type: 'histogram', help: 'HTTP 처리 시간', labels: ['method', 'route'], source: 'platform', buckets: HTTP_BUCKETS },
  { name: 'ff_process_uptime_seconds', type: 'gauge', help: '프로세스 가동 시간', labels: [], source: 'platform' },
  { name: 'ff_process_resident_memory_bytes', type: 'gauge', help: '상주 메모리', labels: [], source: 'platform' },
  { name: 'ff_process_heap_used_bytes', type: 'gauge', help: '힙 사용량', labels: [], source: 'platform' },
  // ── 차량 수신(IF-06 상태 보고 v2·회신) ──
  { name: 'ff_vehicle_status_reports_total', type: 'counter', help: '차량 상태 보고 v2 수신 — 결과(accepted·rejected)와 위반 코드', labels: [...VEHICLE, 'sw_version', 'feature', 'via', 'result', 'code'], source: 'platform' },
  { name: 'ff_vehicle_status_auth_total', type: 'counter', help: '상태 보고 state_auth(CMAC) 검증 — valid·invalid', labels: [...VEHICLE, 'result'], source: 'platform' },
  { name: 'ff_vehicle_dtc_reports_total', type: 'counter', help: 'DTC가 실린 상태 보고 수', labels: [...VEHICLE, 'feature'], source: 'platform' },
  { name: 'ff_vehicle_readbacks_total', type: 'counter', help: '게시본 회신(readback) — 적용·거부와 거부 사유', labels: [...VEHICLE, 'sw_version', 'feature', 'kind', 'via', 'result', 'reason'], source: 'platform' },
  { name: 'ff_vehicle_signature_checks_total', type: 'counter', help: '차량이 회신한 게시본 서명 검증 결과 — valid·invalid', labels: [...VEHICLE, 'kind', 'result'], source: 'platform' },
  { name: 'ff_vehicle_readback_latency_seconds', type: 'histogram', help: '게시본 서명부터 차량 회신까지 걸린 시간', labels: ['kind', 'country'], source: 'platform', buckets: APPLY_LATENCY_BUCKETS },
  { name: 'ff_publication_deliveries_total', type: 'counter', help: '게시본 전달 — 채널별 대상 차량 수(unreachable 포함)', labels: ['kind', 'channel'], source: 'platform' },
  { name: 'ff_vehicles_registered', type: 'gauge', help: '등록 차량 수', labels: [...VEHICLE, 'sw_version'], source: 'platform' },
  { name: 'ff_vehicles_silent', type: 'gauge', help: '창 안에 상태 보고·회신이 한 번도 없는 등록 차량 수(미수신)', labels: [...VEHICLE, 'window'], source: 'platform' },
  // ── 긴급 차단·복원 ──
  { name: 'ff_kill_commands_total', type: 'counter', help: '긴급 차단 명령 발행 수', labels: ['feature', 'deact_class'], source: 'platform' },
  { name: 'ff_kill_releases_total', type: 'counter', help: '차단 해제(복원) 발행 수', labels: ['feature'], source: 'platform' },
  { name: 'ff_kill_apply_latency_seconds', type: 'histogram', help: '차단·복원 명령 발급부터 차량이 끝 상태를 보고하기까지', labels: ['feature', 'deact_class', 'request'], source: 'platform', buckets: APPLY_LATENCY_BUCKETS },
  { name: 'ff_kill_overdue_vehicles_total', type: 'counter', help: '기한(등급별 예상 시간 + 여유)을 넘긴 차량 수', labels: ['feature', 'deact_class'], source: 'platform' },
  { name: 'ff_kill_reissues_total', type: 'counter', help: '같은 명령 재전송 요청 수', labels: ['feature'], source: 'platform' },
  { name: 'ff_kill_target_vehicles', type: 'gauge', help: '걸려 있는 차단의 대상 차량 수', labels: ['feature', 'deact_class'], source: 'platform' },
  { name: 'ff_kill_pending_vehicles', type: 'gauge', help: '걸려 있는 차단 가운데 아직 끝 상태가 아닌 차량 수', labels: ['feature', 'deact_class'], source: 'platform' },
  // ── Flag 평가(OFREP·차량 번들 Hook) ──
  { name: 'ff_flag_evaluations_total', type: 'counter', help: 'Flag 평가 수 — OpenFeature 사유·변형', labels: ['flag', 'feature', 'reason', 'variant', 'provider'], source: 'platform' },
  { name: 'ff_flag_evaluation_errors_total', type: 'counter', help: 'Flag 평가 오류 — 오류 종류', labels: ['flag', 'error'], source: 'platform' },
  { name: 'ff_flag_info', type: 'gauge', help: '배포된 Flag 정보(값 1) — Flag ↔ 정책·Feature 결합용', labels: ['flag', 'policy', 'feature', 'feature_version', 'f_class'], source: 'platform' },
  { name: 'ff_rollout_stage_ratio', type: 'gauge', help: '단계 배포 비율(0~1) — 배포된 정책', labels: ['flag', 'policy', 'feature'], source: 'platform' },
  // ── Unleash·이벤트 ──
  { name: 'ff_unleash_edge_request_duration_seconds', type: 'histogram', help: 'Unleash Edge 호출 시간 — 결과 ok·error', labels: ['op', 'result'], source: 'platform', buckets: HTTP_BUCKETS },
  { name: 'ff_unleash_drift', type: 'gauge', help: 'Unleash 서버 정의가 FF 원천과 다르면 1(마지막 대조)', labels: ['flag'], source: 'platform' },
  { name: 'ff_events_total', type: 'counter', help: '플랫폼 이벤트 수(종류별) — 대시보드 주석(정책 배포·긴급 차단·복원)', labels: ['type'], source: 'platform' },
  { name: 'ff_ext_outbox_pending', type: 'gauge', help: '외부 연계 보낼 함 대기 건수', labels: ['system'], source: 'platform' },
  { name: 'ff_ops_observations_total', type: 'counter', help: 'Grafana 경보로 들어온 운영 관찰(개선 후보) 수', labels: ['axis', 'status'], source: 'platform' },
  { name: 'ff_metrics_series_dropped_total', type: 'counter', help: '시계열 상한을 넘어 _other로 합친 기록 수', labels: ['metric'], source: 'platform' },
  // ── Feature 운영 건강도(Data Lake Gold 집계, 80-75 8장 지표와 같은 뜻) ──
  { name: 'ff_feature_active_vehicles', type: 'gauge', help: 'Feature가 켜져 있는 차량 수(최근 1시간 사용 기준)', labels: FEATURE, source: 'lake' },
  { name: 'ff_feature_usage_seconds_total', type: 'counter', help: 'Feature 사용 시간(초)', labels: FEATURE, source: 'lake' },
  { name: 'ff_feature_activations_total', type: 'counter', help: 'Feature 켜짐 횟수(사용 빈도)', labels: FEATURE, source: 'lake' },
  { name: 'ff_feature_manual_off_total', type: 'counter', help: '운전자가 직접 끈 횟수', labels: FEATURE, source: 'lake' },
  { name: 'ff_feature_quick_off_total', type: 'counter', help: '켠 뒤 60초 안에 끈 횟수(이탈)', labels: FEATURE, source: 'lake' },
  { name: 'ff_feature_fallbacks_total', type: 'counter', help: 'Feature 폴백(Safe Default) 횟수 — 사유', labels: [...FEATURE, 'reason'], source: 'lake' },
  { name: 'ff_feature_errors_total', type: 'counter', help: 'Feature 동작 오류 수', labels: FEATURE, source: 'lake' },
  { name: 'ff_feature_dtc_total', type: 'counter', help: 'Feature 관련 DTC 발생 수', labels: FEATURE, source: 'lake' },
  { name: 'ff_feature_health_indicator', type: 'gauge', help: 'IF-15 Feature 4축 입력 지표 현재 값(/v1/metrics/feature-health)', labels: ['feature', 'feature_version', 'axis', 'indicator'], source: 'lake' },
  { name: 'ff_lake_freshness_seconds', type: 'gauge', help: 'Data Lake 데이터셋 지연(초) — 판단 불가 근거', labels: ['dataset'], source: 'lake' },
];

export const metricDef = (name: string): TelemetryMetricDef | undefined => TELEMETRY_METRICS.find((m) => m.name === name);

/** 쿼리에 나올 수 있는 이름 — histogram은 _bucket·_sum·_count */
export function exposedSeriesNames(defs: readonly TelemetryMetricDef[] = TELEMETRY_METRICS): string[] {
  return defs.flatMap((m) => (m.type === 'histogram' ? [`${m.name}_bucket`, `${m.name}_sum`, `${m.name}_count`] : [m.name]));
}

/** 서명 검증 실패로 보는 차량 거부 사유(PKI verify reason) — 나머지 거부(REPLAY 등)는 서명은 맞은 것 */
// 게시본 서명(pki verify)과 차단 봉투 Guard(REJECT_CODES 중 진위 관련) 둘 다
export const SIGNATURE_REJECT_REASONS = ['BAD_SIGNATURE', 'SIGNATURE_INVALID', 'SIGNATURE_FORMAT', 'PAYLOAD_TAMPERED', 'UNKNOWN_KEY', 'KEY_EXPIRED', 'WRONG_KEY_PURPOSE', 'AUTH_FAILED', 'AUTH_MISSING', 'KEY_EPOCH_OLD'] as const;

/** IF-15 Indicator.axis·name (datalake-if15.openapi.json) — Feature 운영 점검 4축. 축의 정본 정의는 여기 하나(rules/lake가 다시 낸다, 통합 D-INT-3) */
export const HEALTH_AXES = ['OPERATION', 'PROBLEM', 'IMPROVEMENT', 'RISK'] as const;
export type HealthAxis = (typeof HEALTH_AXES)[number];
export const HEALTH_INDICATORS: Record<string, HealthAxis> = {
  delivery_success_rate: 'OPERATION',
  status_rejected_rate: 'OPERATION',
  disabled_share: 'OPERATION',
  dtc_vehicle_rate: 'PROBLEM',
  fault_rate_per_1k: 'PROBLEM',
  safety_event_rate_per_1k: 'PROBLEM',
  incident_count: 'PROBLEM',
  usage_rate: 'IMPROVEMENT',
  manual_off_rate: 'IMPROVEMENT',
  trial_conversion_rate: 'IMPROVEMENT',
  anomaly_open_count: 'RISK',
  security_alert_count: 'RISK',
  data_missing_rate: 'RISK',
};

/** 미수신 창 */
export const SILENT_WINDOWS = { '1h': 3_600_000, '24h': 86_400_000 } as const;

/** 대시보드 주석으로 쓰는 이벤트 — ff_events_total{type}가 이 종류만 센다(종류 수 제한) */
export const ANNOTATION_EVENTS = ['policy.deployed', 'policy.restored', 'rollout.staged', 'kill.issued', 'kill.released', 'kill.overdue', 'rollback.started', 'publication.signed', 'publication.closed', 'release.signed', 'sync.completed', 'ops.observation.recorded'] as const;
