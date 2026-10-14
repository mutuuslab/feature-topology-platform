// 재-HARA 요청 저장소 (FFG-LCY-003) — 검출은 변경 영향 검증(D06-05 ReharaService), Gate 판정(D01-02)은 열린 요청을 읽어 G3 이후 PASS를 막는다.
import { Inject, Injectable } from '@nestjs/common';
import type { ReharaCondition } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';

export interface ReharaRequest {
  requestId: string;
  featureId: string;
  featureVersion: string;
  condition: ReharaCondition;
  detail: string;
  ref: string;
  /** 무엇이 검출을 일으켰나(이벤트 종류·대상) */
  source: { event: string; target: string };
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  resolvedAt: string | null;
  /** 닫은 G2 재판정 기록 */
  resolvedBy: string | null;
}

@Injectable()
export class ReharaRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** 같은 원인(ref)으로 이미 있으면 넣지 않는다 — 넣었으면 true */
  insert(r: Omit<ReharaRequest, 'requestId'>): ReharaRequest | null {
    if (this.db.get('SELECT 1 FROM rehara_request WHERE feature_id = ? AND feature_version = ? AND ref = ?', r.featureId, r.featureVersion, r.ref)) return null;
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM rehara_request')!.n + 1;
    const full: ReharaRequest = { requestId: `RH-${String(n).padStart(5, '0')}`, ...r };
    this.db.run(
      'INSERT INTO rehara_request (request_id, feature_id, feature_version, condition, ref, status, created_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      full.requestId,
      full.featureId,
      full.featureVersion,
      full.condition,
      full.ref,
      full.status,
      full.createdAt,
      JSON.stringify(full),
    );
    return full;
  }

  list(q: { featureId?: string; featureVersion?: string; status?: string } = {}): ReharaRequest[] {
    const where: string[] = [];
    const args: string[] = [];
    if (q.featureId) where.push('feature_id = ?'), args.push(q.featureId);
    if (q.featureVersion) where.push('feature_version = ?'), args.push(q.featureVersion);
    if (q.status) where.push('status = ?'), args.push(q.status);
    return this.db
      .all<{ doc: string }>(`SELECT doc FROM rehara_request ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY request_id`, ...args)
      .map((r) => JSON.parse(r.doc) as ReharaRequest);
  }

  open(featureId: string, version: string): ReharaRequest[] {
    return this.list({ featureId, featureVersion: version, status: 'OPEN' });
  }

  /** G2 재판정 PASS가 열린 요청을 닫는다 — 닫은 요청 목록 */
  resolve(featureId: string, version: string, gateRecordId: string, at: string): ReharaRequest[] {
    const open = this.open(featureId, version);
    for (const r of open) {
      const next: ReharaRequest = { ...r, status: 'RESOLVED', resolvedAt: at, resolvedBy: gateRecordId };
      this.db.run("UPDATE rehara_request SET status = 'RESOLVED', doc = ? WHERE request_id = ?", JSON.stringify(next), r.requestId);
    }
    return open;
  }
}
