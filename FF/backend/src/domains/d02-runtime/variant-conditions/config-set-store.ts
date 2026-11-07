// 승인 조합 읽기(D02-01) — ads_config_set(추가만)에 승인 기록(ads_config_set_approval)을 겹친다. 상태 없는 DB 읽기라 여러 모듈(발행 검사·OTA 설치)이 같이 쓴다.
// 승인 기록이 있거나 이전 판에서 등록 = 승인으로 저장된 행(문서 status APPROVED)은 승인, 나머지는 승인 대기 — 대조·발행 근거는 승인된 것만.
import { isApprovedConfigSet, type ConfigSet } from '@ff/contracts';
import type { Db } from '../../../kernel/db';

type Row = { doc: string; approved_by: string | null; approved_at: string | null; reason: string | null };

const merge = (r: Row): ConfigSet => {
  const d = JSON.parse(r.doc) as ConfigSet;
  const base: ConfigSet = { ...d, proposedBy: d.proposedBy ?? null, proposedAt: d.proposedAt ?? null, approvedBy: d.approvedBy ?? null, approvedAt: d.approvedAt ?? null };
  return r.approved_by ? { ...base, status: 'APPROVED', approvedBy: r.approved_by, approvedAt: r.approved_at, approvalReason: r.reason } : base;
};

const SELECT = 'SELECT s.doc AS doc, a.approved_by AS approved_by, a.approved_at AS approved_at, a.reason AS reason FROM ads_config_set s LEFT JOIN ads_config_set_approval a ON a.set_id = s.set_id';

/** 모든 조합(승인 대기 포함) — 목록·상세 */
export function readConfigSets(db: Db, featureId?: string, version?: string): ConfigSet[] {
  const rows = featureId ? db.all<Row>(`${SELECT} WHERE s.feature_id = ? AND s.feature_version = ? ORDER BY s.set_id`, featureId, version ?? '') : db.all<Row>(`${SELECT} ORDER BY s.set_id`);
  return rows.map(merge);
}

export function readConfigSet(db: Db, setId: string): ConfigSet | null {
  const r = db.get<Row>(`${SELECT} WHERE s.set_id = ?`, setId);
  return r ? merge(r) : null;
}

/** 승인된 조합만 — 차량 대조·발행 후보·복구 재검증 */
export const approvedConfigSets = (db: Db, featureId?: string, version?: string): ConfigSet[] => readConfigSets(db, featureId, version).filter(isApprovedConfigSet);
