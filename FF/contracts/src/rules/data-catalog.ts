// 목적별 데이터 범주와 접근 분리 (보고서 v1.1 13.1 · FFG-TEL-001) — 텔레메트리는 13.1절 목적 범주로 표시하고, 범주마다 읽기 권한과 보존 기간을 따로 둔다.
// 보존 기간은 저장소별(rules/retention.ts), 읽기 권한은 이 표가 단일 소스다 — 텔레메트리 읽기 경로(ROUTES의 dataCategory)는 이 역할만 선언하고,
// 백엔드 핸들러는 같은 표로 @Roles를 건다. 차량 보고마다 data_category(status_report v2 필수)가 붙는다.
import type { Role } from '../enums';
import { RETENTION_POLICIES, type DataCategory } from './retention';

export const DATA_CATEGORIES_13_1: DataCategory[] = ['SAFETY_OPERATION', 'SECURITY_MONITORING', 'COMMERCIAL_USAGE'];

/** 범주별 읽기 역할 — AUDITOR(감사 조회)·SYSTEM은 모든 범주 */
export const DATA_CATEGORY_ACCESS: Record<DataCategory, readonly Role[]> = {
  // 기능안전·SOTIF·ADS 운행 감시·법규 보고 — 안전·운영·검증·법규 담당과 이를 쓰는 엔지니어링 역할
  SAFETY_OPERATION: ['SAFETY_OFFICER', 'OPERATOR', 'OPS_LEAD', 'GATE_JUDGE', 'RELEASE_MANAGER', 'IMPLEMENTER', 'FEATURE_AUTHOR', 'FEATURE_APPROVER', 'REGULATORY_OWNER', 'SECURITY_OFFICER', 'AUDITOR', 'SYSTEM'],
  // 사이버보안 모니터링·포렌식 — CSMS(보안 담당)만
  SECURITY_MONITORING: ['SECURITY_OFFICER', 'AUDITOR', 'SYSTEM'],
  // 상업(사용량·과금) — 상품 담당과 고객 응대 운영
  COMMERCIAL_USAGE: ['PRODUCT_AUTHOR', 'PRODUCT_APPROVER', 'OPERATOR', 'AUDITOR', 'SYSTEM'],
};

export const canReadCategory = (role: Role, category: DataCategory) => DATA_CATEGORY_ACCESS[category].includes(role);

/** 텔레메트리를 읽는 API(ROUTES 이름) — 저장소와 범주. 이 경로는 범주 역할로만 열린다 */
export const TELEMETRY_READS: { route: string; store: string; category: DataCategory }[] = [
  { route: 'vehicleStatusView', store: 'status_report', category: 'SAFETY_OPERATION' },
  { route: 'readbacks', store: 'readback', category: 'SAFETY_OPERATION' },
  { route: 'vehicleRequests', store: 'vehicle_request', category: 'SAFETY_OPERATION' },
  { route: 'securityEvents', store: 'security_event', category: 'SECURITY_MONITORING' },
];

/**
 * 데이터 카탈로그 감사 — 범주 표시가 없는 저장소·읽기 경로, 범주 밖 읽기 권한을 찾는다.
 * @rule FFG-TEL-001 — 목적별 범주 표시와 범주별 접근 권한·보존 기간 분리(범주 표시 없는 필드 0건, 범주 밖 접근 권한 0건)
 */
export function catalogFindings(routes: { name: string; roles?: readonly Role[]; dataCategory?: DataCategory }[]): string[] {
  const out: string[] = [];
  for (const t of TELEMETRY_READS) {
    const store = RETENTION_POLICIES.find((p) => p.store === t.store);
    if (!store) out.push(`${t.store}: 보존 기간·범주가 없습니다`);
    else if (store.category !== t.category) out.push(`${t.store}: 저장소 범주 ${store.category} ≠ 읽기 경로 범주 ${t.category}`);
    const r = routes.find((x) => x.name === t.route);
    if (!r) {
      out.push(`${t.route}: 경로가 없습니다`);
      continue;
    }
    if (r.dataCategory !== t.category) out.push(`${t.route}: 범주 표시 ${r.dataCategory ?? '없음'} ≠ ${t.category}`);
    if (!r.roles?.length) out.push(`${t.route}: 읽기 역할이 없습니다(누구나 읽음)`);
    for (const role of r.roles ?? []) if (!canReadCategory(role, t.category)) out.push(`${t.route}: ${role}는 ${t.category} 범주 밖 역할입니다`);
  }
  for (const r of routes) if (r.dataCategory && !TELEMETRY_READS.some((t) => t.route === r.name)) out.push(`${r.name}: 카탈로그에 없는 범주 경로`);
  return out;
}
