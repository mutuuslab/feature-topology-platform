// 긴급 차단 범위·해제·사건 범위 규칙(P11a, D03-03·D03-04) — 화면·서버 공용 순수 규칙.
// · 차단 중 활성화 거부(FR-KSW-002-006): 긴급(안전·보안·규제·운영) 차단이 걸린 Feature는 새 배포(활성화)를 받지 않는다. 상업 차단(체험 만료 한 대)은 막지 않는다.
// · 차단 상태 차량(FR-KSW-004-004·007): 부분 복원한 차량은 차단에서 빠진다 — 나머지 차량만 차단 유지.
// · 해제 요청 확인 항목(FR-KSW-004-001·002): 차단 사유 해소·원인 조치 완료 둘 다 체크해야 요청을 만든다.
import type { KillRequest } from '../schemas/ops';

/** 활성화를 막는 차단 사유 — 상업 사유(체험 만료 등 차량 한 대의 비활성화)는 기능 배포를 막지 않는다 */
export const ACTIVATION_BLOCKING_CATEGORIES = ['SAFETY', 'SECURITY', 'REGULATORY', 'OPERATIONAL'] as const;

type KillLike = Pick<KillRequest, 'killId' | 'featureId' | 'featureIds' | 'vins' | 'status' | 'reasonCategory' | 'restoredVins'>;

/** 아직 차단 중인 차량 — ACTIVE 차단의 차량에서 부분 복원한 차량을 뺀다 */
export function blockedVins(k: Pick<KillRequest, 'vins' | 'status' | 'restoredVins'>): string[] {
  if (k.status !== 'ACTIVE') return [];
  const done = new Set(k.restoredVins ?? []);
  return k.vins.filter((v) => !done.has(v));
}

/** 이 차량·Feature가 차단 중인가 — 대상 Feature(의존 포함)·남은 차단 차량 모두에 들어야 한다 */
export function isKilled(kills: readonly KillLike[], featureId: string, vin: string): boolean {
  return kills.some((k) => k.featureIds.includes(featureId) && blockedVins(k).includes(vin));
}

/** 활성화(배포)를 막는 차단 — 대상 Feature(의존 포함)에 걸린 ACTIVE 긴급 차단 중 남은 차량이 있는 것 */
export function activationBlockers(kills: readonly KillLike[], featureId: string): KillLike[] {
  return kills.filter(
    (k) => k.featureIds.includes(featureId) && (ACTIVATION_BLOCKING_CATEGORIES as readonly string[]).includes(k.reasonCategory ?? 'SAFETY') && blockedVins(k).length > 0,
  );
}

/** 활성화 거부 문구 — 긴급 차단 상태임을 포함한다(FR-KSW-002-006) */
export function activationBlockedMessage(featureId: string, blockers: readonly Pick<KillRequest, 'killId'>[]): string {
  return `${featureId}은(는) 긴급 차단 상태라 활성화할 수 없습니다 (${blockers.map((b) => b.killId).join(', ')}) — 복원 승인으로 차단을 해제한 뒤 배포하세요.`;
}

/** 해제 요청 확인 항목 — 둘 다 체크해야 요청을 만든다(FR-KSW-004-002) */
export const RESTORE_CHECKS = ['resolved', 'causeFixed'] as const;
export type RestoreCheck = (typeof RESTORE_CHECKS)[number];
export const RESTORE_CHECK_LABEL: Record<RestoreCheck, string> = { resolved: '차단 사유 해소', causeFixed: '원인 조치 완료' };

/** 체크하지 않은 확인 항목 */
export function missingRestoreChecks(body: Partial<Record<RestoreCheck, boolean | undefined>>): RestoreCheck[] {
  return RESTORE_CHECKS.filter((c) => body[c] !== true);
}
