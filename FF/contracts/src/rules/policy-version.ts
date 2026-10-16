// 정책 버전 이력 (D01-06) — 개정본마다 정책 내용 전체를 남기고(덮어쓰지 않는다), 버전 목록·버전 내용·변경 이력(변경 전후)을 보이며,
// 고른 버전을 새 개정본으로 되살린다. 되살린 개정본은 DRAFT — 검증·승인을 다시 받아야 배포된다(승인한 내용 = 배포할 내용, P0 publishCheck).
// 배포된 정책은 바꾸지 않는다(IMMUTABLE) — 배포본을 이전 내용으로 되돌리는 일은 롤백(FR-RBK)이 맡는다.
// @req FR-POL-002-004 FR-PVER-002-001 FR-PVER-002-002 FR-PVER-002-003 FR-PVER-002-004 FR-PVER-002-005 FR-PVER-002-006
import { z } from 'zod';
import { PolicySpec } from '../schemas/policy';

/** 개정본이 생긴 까닭 — IMPORTED는 이력 저장 이전부터 있던 정책의 그때 개정본(그 앞 내용은 남아 있지 않다) */
export const PolicyRevisionKind = z.enum(['CREATE', 'UPDATE', 'RESTORE', 'IMPORTED']);
export type PolicyRevisionKind = z.infer<typeof PolicyRevisionKind>;

export const POLICY_REVISION_KIND_LABEL: Record<PolicyRevisionKind, string> = {
  CREATE: '작성',
  UPDATE: '수정',
  RESTORE: '복원',
  IMPORTED: '이력 시작',
};

/** 이 상태의 정책만 내용을 바꾸거나 되살릴 수 있다 — 승인·배포·폐기된 정책은 새 정책으로 */
export const POLICY_EDITABLE = ['DRAFT', 'VALIDATED', 'REJECTED'] as const;

export interface PolicyRevision {
  policyId: string;
  revision: number;
  contentHash: string;
  kind: PolicyRevisionKind;
  changedBy: string;
  changedAt: string;
  /** RESTORE일 때 되살린 개정본 */
  restoredFrom: number | null;
  reason: string | null;
  spec: PolicySpec;
}

export interface PolicyChange {
  /** 바뀐 항목 — 점 경로(rollout.basisPoints). 배열은 통째로 비교한다 */
  path: string;
  before: unknown;
  after: unknown;
}

/** 정책 내용만 고른다 — 상태·승인자 같은 운영 필드는 버전 내용이 아니다 */
export function policySpecOf(doc: Record<string, unknown>): PolicySpec {
  return PolicySpec.parse(Object.fromEntries(Object.keys(PolicySpec.shape).filter((k) => doc[k] !== undefined).map((k) => [k, doc[k]])));
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function walk(before: unknown, after: unknown, path: string, out: PolicyChange[]) {
  if (isObj(before) && isObj(after)) {
    for (const k of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) walk(before[k], after[k], path ? `${path}.${k}` : k, out);
    return;
  }
  if (!same(before, after)) out.push({ path, before: before ?? null, after: after ?? null });
}

/** 두 버전의 차이 — 처음 작성(before 없음)이면 모든 항목이 새로 생긴 것 */
export function policyDiff(before: PolicySpec | null, after: PolicySpec): PolicyChange[] {
  const out: PolicyChange[] = [];
  walk(before ?? {}, after, '', out);
  return out;
}

/** 변경 이력 한 줄 — 누가·언제·변경 전·변경 후 (FR-PVER-002-005) */
export interface PolicyChangeEntry {
  revision: number;
  kind: PolicyRevisionKind;
  changedBy: string;
  changedAt: string;
  restoredFrom: number | null;
  reason: string | null;
  before: PolicySpec | null;
  after: PolicySpec;
  changes: PolicyChange[];
}

/** 개정본 목록(오름차순)에서 변경 이력(최신 순) — IMPORTED 앞 내용은 없다 */
export function policyChangeLog(revisions: PolicyRevision[]): PolicyChangeEntry[] {
  const asc = [...revisions].sort((a, b) => a.revision - b.revision);
  return asc
    .map((r, i) => {
      const before = r.kind === 'IMPORTED' ? null : (asc[i - 1]?.spec ?? null);
      return { revision: r.revision, kind: r.kind, changedBy: r.changedBy, changedAt: r.changedAt, restoredFrom: r.restoredFrom, reason: r.reason, before, after: r.spec, changes: r.kind === 'IMPORTED' ? [] : policyDiff(before, r.spec) };
    })
    .reverse();
}

export const RestorePolicyRevisionBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();
export type RestorePolicyRevisionBody = z.infer<typeof RestorePolicyRevisionBody>;
