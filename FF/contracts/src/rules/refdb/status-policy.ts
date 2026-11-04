// 기준 행 상태 → 허용 규칙(30-95 §5.2, D-REF-6·7) — 등록 화면·Feature 승인 전이·산정 과제가 같은 표를 본다.
// 수명주기 규칙(lifecycle.ts)은 이 표의 blocksApproval로 PROPOSED→APPROVED를 막는다.
import type { FeatureRefRole, RefStatus } from '../../schemas/refdb';

export interface RefStatusPolicy {
  /** 등록 화면에서 고를 수 있다 */
  selectable: boolean;
  /** 고를 때 경고를 띄운다(관리 메모 사유·대체 행 안내) */
  warn: boolean;
  /** 연결된 Feature의 정의 승인(PROPOSED→APPROVED)을 막는다 */
  blocksApproval: boolean;
  /** 산정 과제에 새 줄로 쓸 수 있다 */
  costUsable: boolean;
  /** 산정에 쓸 때 경고 */
  costWarn: boolean;
  /** 화면 표시 이름(엑셀 BQ 값) */
  ko: string;
  /** 등록·승인 때 안내 문구 */
  hint: string;
}

export const REF_STATUS_POLICY: Record<RefStatus, RefStatusPolicy> = {
  ACTIVE: { selectable: true, warn: false, blocksApproval: false, costUsable: true, costWarn: false, ko: '활성', hint: '근거와 크기 판단을 확인한 행입니다.' },
  REVIEW: { selectable: true, warn: true, blocksApproval: false, costUsable: true, costWarn: true, ko: '검토 필요', hint: '근거가 2차 자료이거나 인용 경로가 바뀐 행입니다 — 관리 메모의 사유를 확인하세요.' },
  DEPRECATED: { selectable: true, warn: true, blocksApproval: false, costUsable: true, costWarn: true, ko: '폐기 예정', hint: '대체 행이 있으면 대체 행을 쓰세요.' },
  RETIRED: { selectable: false, warn: true, blocksApproval: true, costUsable: false, costWarn: false, ko: '폐기', hint: '더 이상 쓰지 않는 행입니다 — 다른 기준 행을 연결하세요.' },
  PENDING: { selectable: true, warn: true, blocksApproval: true, costUsable: false, costWarn: false, ko: '요청 중', hint: 'Feature DB 관리자 승인 전입니다 — 승인되기 전에는 Feature 정의 승인을 할 수 없습니다.' },
};

export const refStatusPolicy = (s: RefStatus): RefStatusPolicy => REF_STATUS_POLICY[s];

export interface RefLinkBlocker {
  refId: string;
  role: FeatureRefRole;
  /** 기준 행이 없으면 null */
  status: RefStatus | null;
  message: string;
}

/**
 * 연결된 기준 행 중 정의 승인을 막는 것 — PENDING·RETIRED, 그리고 Feature DB에 없는 ID.
 * statusOf는 지금 Feature DB의 상태(없으면 undefined).
 */
export function refLinksBlockApproval(
  links: readonly { refId: string; role: FeatureRefRole }[],
  statusOf: (refId: string) => RefStatus | null | undefined,
): RefLinkBlocker[] {
  const out: RefLinkBlocker[] = [];
  for (const l of links) {
    const status = statusOf(l.refId) ?? null;
    if (!status) out.push({ ...l, status, message: `기준 행 ${l.refId}이(가) Feature DB에 없습니다 — 다른 기준 행을 연결하세요.` });
    else if (REF_STATUS_POLICY[status].blocksApproval) out.push({ ...l, status, message: `기준 행 ${l.refId}이(가) ${REF_STATUS_POLICY[status].ko} 상태입니다 — ${REF_STATUS_POLICY[status].hint}` });
  }
  return out;
}
