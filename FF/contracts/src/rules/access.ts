// 플랫폼 인증·권한(IAM, D06-09) — 역할별 권한은 ROUTES의 roles에서 그대로 나온다(라우트 하나가 원천: 화면·API·권한표가 어긋날 수 없다).
// 직무 분리(SoD) 규칙은 상세설계서의 승인 규칙을 표로 둔다 — 실제 강제는 각 서비스(감사 FAILED/DENIED로 남는다).
import { ROLES, ROLE_LABEL, type Role } from '../enums';
import type { ApproverRole } from '../schemas/safety';
import { ROUTES, type RouteDef } from '../routes';

/** 사람 역할 — 차량 기기 신원(VEHICLE)은 역할 선택·권한표에서 뺀다 */
export const HUMAN_ROLES = ROLES.filter((r) => r !== 'VEHICLE' && r !== 'SYSTEM') as Role[];

export interface Permission {
  name: string;
  method: RouteDef['method'];
  path: string;
  summary: string;
  component: string;
  roles: Role[];
}

/** 변경 API 중 역할 제한이 있는 것 — 권한표의 행 */
export function permissions(routes: RouteDef[] = ROUTES): Permission[] {
  return routes.filter((r) => r.method !== 'GET' && r.roles?.length).map((r) => ({ name: r.name, method: r.method, path: r.path, summary: r.summary, component: r.component, roles: r.roles! }));
}

export function rolesView(routes: RouteDef[] = ROUTES) {
  const perms = permissions(routes);
  return [...ROLES].map((role) => ({ role, label: ROLE_LABEL[role], human: (HUMAN_ROLES as string[]).includes(role), allowed: perms.filter((p) => p.roles.includes(role)).map((p) => p.name) }));
}

/** 직무 분리 — 같은 사람이 두 역할을 겹쳐 수행할 수 없다 */
export const SOD_RULES: { id: string; subject: string; rule: string; component: string }[] = [
  { id: 'SOD-01', subject: 'Feature 정의 승인', rule: 'Feature 작성자는 자기 Feature를 승인할 수 없다', component: 'D01-01' },
  { id: 'SOD-02', subject: 'BOM Baseline 확정', rule: '확정 요청자와 BOM 승인자는 달라야 한다', component: 'D01-01' },
  { id: 'SOD-03', subject: '상품 구성 승인', rule: '상품 작성자는 자기 상품을 승인할 수 없다', component: 'D01-03' },
  { id: 'SOD-04', subject: '상품 고객 출시', rule: '구성 승인자와 고객 출시 승인자는 달라야 한다', component: 'D01-03' },
  { id: 'SOD-05', subject: '정책 승인', rule: '정책 작성자는 자기 정책을 승인할 수 없다 (P0 publishCheck SELF_APPROVAL)', component: 'D03-02' },
  { id: 'SOD-06', subject: 'G5 증적', rule: 'vECU 가상검증은 TMS 제출(IF-09)된 실제 실행 PASS만 G5 PASS 근거가 된다', component: 'D04-02' },
  { id: 'SOD-07', subject: '차량 신원', rule: '차량은 자기 VIN만 조회·보고하고 Flag 값을 직접 바꿀 수 없다', component: 'D02-03' },
  // 보고서 v1.1 FFG-PLT-016 — 요구 승인·출시·Kill 실행·복원 승인 권한 분리, 요청자 ≠ 승인자, 긴급 권한은 사후 검토
  { id: 'SOD-08', subject: '긴급 차단 승인', rule: '차단 요청자는 같은 명령의 승인자가 될 수 없다 — 서로 다른 2인 승인, F2 이상 안전·보안 사유는 FSM 포함 (FFG-PLT-005·016)', component: 'D03-03' },
  { id: 'SOD-09', subject: '복원 승인', rule: '복원 승인자는 직전 차단 승인자와 겹칠 수 없다 (FFG-DEAC-008)', component: 'D03-04' },
  { id: 'SOD-10', subject: '대량 차단', rule: '24시간 누적 상한을 넘는 차단은 FSM과 CSM이 함께 승인한다 (FFG-SEC-003)', component: 'D03-03' },
  { id: 'SOD-11', subject: '원격 종료 권한', rule: '원격 종료(Kill) 실행 권한은 별도 역할로 두고, 긴급 사용은 24시간 안에 사후 독립 검토 (FFG-SEC-008·FFG-PLT-016)', component: 'D06-09' },
  { id: 'SOD-12', subject: '서명 키 용도', rule: '활성화·차단·복원·정책 서명 키는 용도별로 분리 — 다른 용도의 키로 서명한 명령은 무효 (FFG-SEC-002)', component: 'D06-10' },
];

/** 보고서 v1.1 승인 역할(kill_command v2 approvals[].role) ↔ 플랫폼 역할 */
export const REPORT_APPROVER_ROLES: Record<ApproverRole, Role> = {
  FSM: 'SAFETY_OFFICER',
  CSM: 'SECURITY_OFFICER',
  OPS_LEAD: 'OPS_LEAD',
  PRODUCT_OWNER: 'PRODUCT_APPROVER',
  QA: 'GATE_JUDGE',
  REGULATORY: 'REGULATORY_OWNER',
};

/** 플랫폼 역할 → 이 사람이 맡을 수 있는 보고서 승인 역할 */
/** 긴급 차단·복원 승인 칸을 채울 수 있는 플랫폼 역할(보고서 승인 역할 대응) */
export const KILL_APPROVER_ROLES: Role[] = [...new Set(Object.values(REPORT_APPROVER_ROLES))];

export function reportRolesOf(roles: readonly Role[]): ApproverRole[] {
  return (Object.keys(REPORT_APPROVER_ROLES) as ApproverRole[]).filter((a) => roles.includes(REPORT_APPROVER_ROLES[a]));
}
