// 운영 관찰(개선 후보) — Grafana 경보 webhook이 FF로 돌아온 기록(80-80 Closed loop). 이벤트 'ops.observation.recorded'의 payload.
// Feature 운영 점검(TL-B08 Finding)·Feature 상세 '운영 지표'(TL-UI04/18)가 이 기록을 근거로 읽는다.
import { z } from 'zod';

export const ObservationAxis = z.enum(['OPERATION', 'PROBLEM', 'IMPROVEMENT', 'RISK', 'PLATFORM']);
export type ObservationAxis = z.infer<typeof ObservationAxis>;

export const OpsObservation = z.object({
  observationId: z.string(),
  source: z.literal('GRAFANA'),
  rule: z.string(),
  status: z.enum(['firing', 'resolved']),
  axis: ObservationAxis,
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  featureId: z.string().nullable(),
  featureVersion: z.string().nullable(),
  flagKey: z.string().nullable(),
  country: z.string().nullable(),
  vehicleModel: z.string().nullable(),
  summary: z.string(),
  description: z.string().nullable(),
  /** 경보 평가 값(쿼리 결과) — 문자열 그대로 */
  value: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  fingerprint: z.string(),
  dashboardUrl: z.string().nullable(),
  panelUrl: z.string().nullable(),
  /** 문제·운영·위험 축이 Feature를 가리키면 이상 징후(D06-12) 신호로도 넣는다 */
  anomalyKind: z.enum(['FEATURE_FAULT', 'DELIVERY', 'SECURITY']).nullable(),
  /** 규칙 라벨 ff_indicator — FF 판정 지표(INDICATOR_RULES)로 단 경보면 Feature 운영 점검 결과의 감지 입력(통합 D-INT-3) */
  indicator: z.string().nullable().default(null),
  receivedAt: z.string(),
});
export type OpsObservation = z.infer<typeof OpsObservation>;

/** 경보 라벨 → 축 — 규칙 라벨 ff_axis가 없으면 PLATFORM */
export const observationAxisOf = (v: unknown): ObservationAxis => (ObservationAxis.options as string[]).includes(String(v)) ? (v as ObservationAxis) : 'PLATFORM';
/** Grafana 라벨 severity(critical·warning·info) → 이상 징후 심각도 */
export const observationSeverityOf = (v: unknown): OpsObservation['severity'] => (String(v).toLowerCase() === 'critical' ? 'CRITICAL' : String(v).toLowerCase() === 'info' ? 'INFO' : 'WARNING');
