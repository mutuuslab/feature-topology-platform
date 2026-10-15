// 보존과 삭제 (보고서 v1.1 13.1·13.7 · FFG-TEL-008) — 플랫폼 저장소마다 13.7절의 기록 종류·데이터 범주(13.1)·보존 기간을 두고,
// 기간이 지난 행은 지운다. 열린 Incident(현장 장애·VOC)나 열린 이상 건에 연결된 차량·Feature의 데이터는 기간이 지나도 남긴다(시정 조치·검토 중).
// 보고서가 수치를 주지 않은 기간은 운영 설정값(가정)으로 표시한다. Safety Case·시장 최장 요건 기록은 플랫폼 sweep이 지우지 않는다.

export type DataCategory = 'SAFETY_OPERATION' | 'SECURITY_MONITORING' | 'COMMERCIAL_USAGE';

export type RetentionPeriod =
  /** assumed: 보고서에 수치가 없어 운영 설정값(가정)으로 둔 기간 */
  | { kind: 'DAYS'; days: number; assumed: boolean }
  /** Safety Case 보존 기간과 같게 — 플랫폼 sweep 대상 아님 */
  | { kind: 'SAFETY_CASE' }
  /** 가장 긴 시장 요건(중국은 차종 생산 중단 후 최소 10년) — 생산 중단일이 정해지기 전에는 지우지 않는다 */
  | { kind: 'MARKET_LONGEST' };

export interface RetentionPolicy {
  /** 플랫폼 저장소(테이블) */
  store: string;
  /** 13.7절 기록 종류 */
  record: string;
  category: DataCategory;
  period: RetentionPeriod;
  basis: string;
  /** 개인정보가 들어갈 수 있는 기록 — 목적 달성 후 지체 없이 삭제 */
  personal: boolean;
}

const DAY_MS = 86_400_000;

export const RETENTION_POLICIES: RetentionPolicy[] = [
  { store: 'audit', record: '감사 이력', category: 'SAFETY_OPERATION', period: { kind: 'SAFETY_CASE' }, basis: 'ISO 26262-8:2018 cl.10', personal: false },
  { store: 'gate_decision', record: 'Gate 결정', category: 'SAFETY_OPERATION', period: { kind: 'SAFETY_CASE' }, basis: 'ISO 26262-8:2018 cl.10', personal: false },
  { store: 'sums_record', record: 'SUMS 기록(명령, 영향평가, 결과)', category: 'SAFETY_OPERATION', period: { kind: 'MARKET_LONGEST' }, basis: 'GB 44496 §4.1.2', personal: false },
  { store: 'security_event', record: '보안 로그', category: 'SECURITY_MONITORING', period: { kind: 'DAYS', days: 3 * 365, assumed: false }, basis: 'UN R155, MIIT 2026 국외 이전 지침(3년 이상)', personal: false },
  { store: 'status_report', record: '상태 보고(운행 중 안전 데이터)', category: 'SAFETY_OPERATION', period: { kind: 'DAYS', days: 365, assumed: true }, basis: 'UN ADS GTR 제안문 §5.1.8.5.3 — 안전 문제 관련은 시정 조치·검토가 끝날 때까지', personal: false },
  { store: 'readback', record: '적용 확인(readback)', category: 'SAFETY_OPERATION', period: { kind: 'DAYS', days: 365, assumed: true }, basis: 'UN ADS GTR 제안문 §5.1.8.5.3', personal: false },
  { store: 'vehicle_request', record: '차량 발신 보고(문맥·체험 수락 포함)', category: 'COMMERCIAL_USAGE', period: { kind: 'DAYS', days: 30, assumed: true }, basis: 'GDPR Art.5, PIPL — 목적 달성 후 지체 없이 삭제', personal: true },
];

export const retentionPolicy = (store: string): RetentionPolicy | null => RETENTION_POLICIES.find((p) => p.store === store) ?? null;

/** 이 시각 이전 행은 기간이 지났다 — 플랫폼 sweep 대상이 아니면 null */
export function retentionCutoff(p: RetentionPolicy, now: string): string | null {
  return p.period.kind === 'DAYS' ? new Date(Date.parse(now) - p.period.days * DAY_MS).toISOString() : null;
}

/** 열린 Incident·이상 건이 묶어 둔 차량(VIN·가명)과 Feature — 값은 묶은 건 ID */
export interface RetentionHolds {
  vehicles: Map<string, string[]>;
  features: Map<string, string[]>;
}

export interface RetentionRow {
  at: string;
  /** VIN 또는 차량 가명 */
  vehicle: string | null;
  featureId: string | null;
}

export type RetentionVerdict = { verdict: 'KEEP' } | { verdict: 'HOLD'; refs: string[] } | { verdict: 'DELETE' };

/**
 * 행 하나의 보존 판정 — 기간 안이면 KEEP, 지났어도 열린 건에 연결되면 HOLD, 아니면 DELETE.
 * @rule FFG-TEL-008 — 범주별 보존 기간 적용·기간 초과 삭제·열린 Incident 데이터 삭제 금지
 */
export function retentionVerdict(row: RetentionRow, p: RetentionPolicy, now: string, holds: RetentionHolds): RetentionVerdict {
  const cutoff = retentionCutoff(p, now);
  if (!cutoff || row.at >= cutoff) return { verdict: 'KEEP' };
  const refs = [...(row.vehicle ? (holds.vehicles.get(row.vehicle) ?? []) : []), ...(row.featureId ? (holds.features.get(row.featureId) ?? []) : [])];
  return refs.length ? { verdict: 'HOLD', refs: [...new Set(refs)] } : { verdict: 'DELETE' };
}
