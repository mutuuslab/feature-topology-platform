// ADS 구성 승인 — 승인 조합 제안→승인(작성자 ≠ 승인자)과 보안 최소 버전 표(차량사이버보안 담당 승인). 순수 규칙(첫 화면 zod 금지).
// 확정(2026-11-07): 조합 등록은 제안, 다른 사람이 승인해야 발행·대조 근거가 된다. 보안 최소 버전의 정본은 승인된 표 — 조합 본문으로 낮출 수 없다.
import { semverCompare } from '../flags/p0';
import type { ConfigSet } from './ads-config';

// ───────────────────────── 승인 조합 제안 → 승인 ─────────────────────────

export const CONFIG_SET_STATUS_LABEL: Record<ConfigSet['status'], string> = { PROPOSED: '승인 대기', APPROVED: '승인' };
export const CONFIG_SET_SELF_APPROVAL = '조합을 제안한 사람은 그 조합을 승인할 수 없습니다 — 다른 담당자가 승인합니다.';

/** 발행·대조 근거로 쓰는 조합 — 승인된 것만(승인 대기 조합은 차량 대조·발행 후보에 넣지 않는다) */
export const isApprovedConfigSet = (s: Pick<ConfigSet, 'status'>): boolean => s.status === 'APPROVED';

/** 조합 승인 막힘 사유 — 이미 승인·제안자 본인. 없으면 null */
export function configSetApprovalBlocker(set: Pick<ConfigSet, 'status' | 'proposedBy'>, actorId: string): { code: 'ALREADY_APPROVED' | 'SELF_APPROVAL'; message: string } | null {
  if (set.status === 'APPROVED') return { code: 'ALREADY_APPROVED', message: '이미 승인된 조합입니다.' };
  if (set.proposedBy && set.proposedBy === actorId) return { code: 'SELF_APPROVAL', message: CONFIG_SET_SELF_APPROVAL };
  return null;
}

// ───────────────────────── 보안 최소 버전 표 ─────────────────────────

export interface SecurityMinEntry {
  entryId: string;
  swId: string;
  version: string;
  status: 'PROPOSED' | 'APPROVED';
  rationale: string;
  proposedBy: string;
  proposedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalReason: string | null;
}
export const SECURITY_MIN_STATUS_LABEL: Record<SecurityMinEntry['status'], string> = { PROPOSED: '승인 대기', APPROVED: '승인' };
export const SECURITY_MIN_SELF_APPROVAL = '보안 최소 버전을 제안한 사람은 그 값을 승인할 수 없습니다 — 다른 사이버보안 담당자가 승인합니다.';

/** SW별 지금 보안 최소 버전 — 승인된 행 중 가장 높은 버전(낮아지지 않는다). 비교할 수 없는 값은 앞(먼저 승인된) 값을 둔다 */
export function effectiveSecurityMins(entries: readonly SecurityMinEntry[]): ConfigSet['securityMin'] {
  const out = new Map<string, { swId: string; version: string }>();
  for (const e of entries) {
    if (e.status !== 'APPROVED') continue;
    const cur = out.get(e.swId);
    if (!cur || semverCompare(e.version, cur.version) === 1) out.set(e.swId, { swId: e.swId, version: e.version });
  }
  return [...out.values()].sort((a, b) => (a.swId < b.swId ? -1 : a.swId > b.swId ? 1 : 0));
}

/** 표에 승인 값이 없는 SW — 하한을 모르면 조합을 등록·승인하지 않는다(판단 불가를 통과로 보지 않는다) */
export function unregisteredSecurityMin(ecuSw: readonly { swId: string }[], table: ConfigSet['securityMin']): string[] {
  const have = new Set(table.map((m) => m.swId));
  return [...new Set(ecuSw.map((s) => s.swId).filter((id) => !have.has(id)))];
}

export const SECURITY_MIN_UNREGISTERED = (swIds: string[]) => `보안 최소 버전 표에 승인된 값이 없는 SW가 있어 이 조합을 처리할 수 없습니다(${swIds.join(', ')}) — 사이버보안 담당자가 먼저 표에 승인합니다.`;

/** 새 값 제안 막힘 사유 — 지금 하한보다 낮거나 같으면 거부(anti-rollback 하한은 올리기만), 비교할 수 없으면 거부 */
export function securityMinProposalBlocker(entries: readonly SecurityMinEntry[], swId: string, version: string): { code: 'SECURITY_MIN_LOWERING' | 'SECURITY_MIN_UNCOMPARABLE'; message: string } | null {
  const cur = effectiveSecurityMins(entries).find((m) => m.swId === swId);
  if (!cur) return null;
  const c = semverCompare(version, cur.version);
  if (c === null) return { code: 'SECURITY_MIN_UNCOMPARABLE', message: `${swId} ${version}을(를) 지금 보안 최소 버전 ${cur.version}과 비교할 수 없습니다.` };
  if (c <= 0) return { code: 'SECURITY_MIN_LOWERING', message: `${swId}의 보안 최소 버전은 지금 ${cur.version}입니다 — 같거나 낮은 값(${version})으로 바꿀 수 없습니다.` };
  return null;
}

/** 승인 막힘 사유 — 이미 승인·제안자 본인·그 사이 더 높은 값이 승인됨. 없으면 null */
export function securityMinApprovalBlocker(entries: readonly SecurityMinEntry[], entry: SecurityMinEntry, actorId: string): { code: 'ALREADY_APPROVED' | 'SELF_APPROVAL' | 'SECURITY_MIN_LOWERING' | 'SECURITY_MIN_UNCOMPARABLE'; message: string } | null {
  if (entry.status === 'APPROVED') return { code: 'ALREADY_APPROVED', message: '이미 승인된 보안 최소 버전입니다.' };
  if (entry.proposedBy === actorId) return { code: 'SELF_APPROVAL', message: SECURITY_MIN_SELF_APPROVAL };
  return securityMinProposalBlocker(entries, entry.swId, entry.version);
}
