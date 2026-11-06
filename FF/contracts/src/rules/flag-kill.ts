// Feature Flag 탭 5단계(차량 수신)에 보일 진행 중 긴급 차단 — 서버(flag-source.service)와 브라우저 시뮬레이터가 같은 규칙으로 고른다.
// 이 Flag의 Feature를 차단 중(ACTIVE — REQUIRES로 함께 막힌 Feature 포함)인 가장 최근 차단 하나. 반영 n/m은 그 차단 게시본의 차량 회신 집계다.

export interface FlagKillSource {
  killId: string;
  status: string;
  featureId: string;
  /** 함께 차단한 Feature(REQUIRES 의존 포함) — 없으면 featureId 하나 */
  featureIds?: readonly string[] | null;
  /** 차단 게시본 회신 집계 — 아직 게시 전이면 null */
  delivery?: { confirmed: number; denominator: number } | null;
  vins?: readonly string[] | null;
}

export interface FlagKill {
  killId: string;
  confirmed: number;
  denominator: number;
}

/** 이 Feature를 지금 차단 중인 가장 최근 차단 — 없으면 null */
export function flagKillOf(featureId: string | null, kills: readonly FlagKillSource[]): FlagKill | null {
  if (!featureId) return null;
  const hit = kills
    .filter((k) => k.status === 'ACTIVE' && (k.featureIds?.length ? k.featureIds : [k.featureId]).includes(featureId))
    .sort((a, b) => (a.killId < b.killId ? 1 : a.killId > b.killId ? -1 : 0))[0];
  if (!hit) return null;
  return { killId: hit.killId, confirmed: hit.delivery?.confirmed ?? 0, denominator: hit.delivery?.denominator ?? hit.vins?.length ?? 0 };
}
