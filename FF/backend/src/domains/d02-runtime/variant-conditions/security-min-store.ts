// 보안 최소 버전 표 읽기(D02-01) — 제안(ads_security_min, 추가만)에 승인 기록(ads_security_min_approval)을 겹친다. 지금 하한 = SW별 승인 최고 버전
import { effectiveSecurityMins, type ConfigSet, type SecurityMinEntry } from '@ff/contracts';
import type { Db } from '../../../kernel/db';

type Row = { entry_id: string; sw_id: string; version: string; rationale: string; proposed_by: string; proposed_at: string; approved_by: string | null; approved_at: string | null; reason: string | null };

export function readSecurityMins(db: Db): SecurityMinEntry[] {
  return db
    .all<Row>('SELECT m.entry_id, m.sw_id, m.version, m.rationale, m.proposed_by, m.proposed_at, a.approved_by, a.approved_at, a.reason FROM ads_security_min m LEFT JOIN ads_security_min_approval a ON a.entry_id = m.entry_id ORDER BY m.entry_id')
    .map((r) => ({ entryId: r.entry_id, swId: r.sw_id, version: r.version, rationale: r.rationale, proposedBy: r.proposed_by, proposedAt: r.proposed_at, status: r.approved_by ? 'APPROVED' : 'PROPOSED', approvedBy: r.approved_by, approvedAt: r.approved_at, approvalReason: r.reason }));
}

/** SW별 지금 하한(승인된 값만) */
export const securityMinTable = (db: Db): ConfigSet['securityMin'] => effectiveSecurityMins(readSecurityMins(db));
