// OTA 전달 대사(P9) — webhook이 끝내 오지 않은 작업을 OTA 작업 조회(GET /ota/v1/jobs/{jobId})로 메우고(80-45 §14 '조회 보충 없음' 해소),
// OTA 사실(넘겼다·응답 없음)과 차량 결과(서명된 회신)가 어긋나면 전달 이상 징후로 올린다(80-45 §14 '불일치 경보 없음' 해소).
// 끝 상태는 여전히 차량 결과만 정한다 — 이 규칙은 판정을 바꾸지 않고 운영자가 "차량이 안 한 것"과 "보고가 안 온 것"을 구별하게 한다.
import type { OtaVehicleOutcome } from './ota';

/** webhook을 이만큼 못 받은 작업(SUBMITTED)을 조회로 대사한다 — FF_OTA_RECONCILE_MS로 바꾼다 */
export const OTA_RECONCILE_AFTER_MS = 2 * 60_000;

/** 불일치 코드 — 전달 이상(DELIVERY) 신호의 code */
export const OTA_MISMATCH = {
  /** OTA 서버는 차량에 넘겼다(DELIVERED)는데 회신 기한까지 차량 결과가 없다 — 차량 미적용 또는 Lake 경로 지연 */
  OTA_DELIVERED_NO_VEHICLE_RESULT: 'OTA 서버는 차량에 넘겼다고 했지만 회신 기한까지 차량 결과가 없습니다',
  /** OTA 서버는 넘기지 못했다(NO_RESPONSE·NOT_ELIGIBLE·CANCELLED)는데 차량 결과가 있다 — 다른 경로 전달 또는 OTA 기록 오류 */
  VEHICLE_RESULT_WITHOUT_OTA_DELIVERY: 'OTA 서버는 전달하지 못했다고 했지만 차량 결과가 왔습니다',
} as const;
export type OtaMismatchCode = keyof typeof OTA_MISMATCH;

export interface OtaMismatch {
  vin: string;
  code: OtaMismatchCode;
  otaOutcome: OtaVehicleOutcome;
}

/**
 * 게시본이 닫힌 뒤 차량별 대사 — nodes는 회신 집계 노드(state UNKNOWN = 차량 결과 없음, 거부 회신은 사유 REJECTED:*로 결과 있음).
 * OTA 결과가 없는 차량(다른 채널·OTA 기록 없음)은 보지 않는다.
 */
export function otaMismatches(nodes: readonly { nodeId: string; state: string; reason: string }[], ota: ReadonlyMap<string, OtaVehicleOutcome>): OtaMismatch[] {
  const out: OtaMismatch[] = [];
  for (const n of nodes) {
    const o = ota.get(n.nodeId);
    if (!o) continue;
    const hasResult = n.state !== 'UNKNOWN' || n.reason.startsWith('REJECTED:');
    if (o === 'DELIVERED' && !hasResult) out.push({ vin: n.nodeId, code: 'OTA_DELIVERED_NO_VEHICLE_RESULT', otaOutcome: o });
    else if ((o === 'NO_RESPONSE' || o === 'NOT_ELIGIBLE' || o === 'CANCELLED') && hasResult) out.push({ vin: n.nodeId, code: 'VEHICLE_RESULT_WITHOUT_OTA_DELIVERY', otaOutcome: o });
  }
  return out.sort((a, b) => a.vin.localeCompare(b.vin));
}
