// 권한 범위(ADS-BE15·FFP-F057) — 역할 권한(ROUTES roles) 위에 계정별 시장·Feature·환경 범위를 겹친다. 순수 규칙(첫 화면 zod 금지).
// 범위가 없는 계정은 역할 권한 그대로(제한 없음). 범위가 있으면 종료·해제·발행 명령의 대상이 범위 안이어야 한다(밖이면 SCOPE_DENIED·감사 DENIED).
// 축마다 null = 제한 없음, 빈 목록 = 그 축의 모든 대상 거부.

export const SCOPE_AXES = ['markets', 'featureIds', 'environments'] as const;
export type ScopeAxis = (typeof SCOPE_AXES)[number];
export const SCOPE_AXIS_LABEL: Record<ScopeAxis, string> = { markets: '시장', featureIds: 'Feature', environments: '환경' };

export interface RoleScope {
  accountId: string;
  markets: string[] | null;
  featureIds: string[] | null;
  environments: string[] | null;
  assignedBy: string;
  assignedAt: string;
  reason: string;
}

/** 범위를 보는 명령 — 종료(긴급 차단)·해제(복원·레거시 해제)·발행(정책 배포). 이름은 contracts ROUTES */
export const SCOPED_COMMANDS = ['issueKill', 'approveKill', 'rejectKill', 'requestRestore', 'approveRestore', 'rejectRestore', 'releaseKill', 'deployPolicy'] as const;
export type ScopedCommand = (typeof SCOPED_COMMANDS)[number];

export interface ScopeTarget {
  featureId: string;
  market: string | null;
  environment: string;
}

/** 범위 밖 사유 — 첫 번째로 걸린 축. 범위 안이거나 범위가 없으면 null. 시장을 모르면(대상 Feature 없음) 시장 제한 계정은 거부 */
export function scopeViolation(scope: Pick<RoleScope, ScopeAxis> | null, t: ScopeTarget): { axis: ScopeAxis; message: string } | null {
  if (!scope) return null;
  if (scope.environments && !scope.environments.includes(t.environment)) return { axis: 'environments', message: `이 계정의 권한 범위에 ${t.environment} 환경이 없습니다.` };
  if (scope.markets && (!t.market || !scope.markets.includes(t.market))) return { axis: 'markets', message: `이 계정의 권한 범위에 ${t.market ?? '확인되지 않은'} 시장이 없습니다.` };
  if (scope.featureIds && !scope.featureIds.includes(t.featureId)) return { axis: 'featureIds', message: `이 계정의 권한 범위에 ${t.featureId}이(가) 없습니다.` };
  return null;
}

/** 화면 표시 — 축 값 글자(null = 전체) */
export const scopeAxisText = (v: string[] | null): string => (v === null ? '전체' : v.length ? v.join(', ') : '없음');
