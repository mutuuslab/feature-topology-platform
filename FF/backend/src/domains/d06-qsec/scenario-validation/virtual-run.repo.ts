// 가상검증(CARLA) 실행 기록 — 정책 검증기(D06-03·D06-06)와 Gate 판정(G5 Evidence 확인)이 함께 읽는다.
import { Inject, Injectable } from '@nestjs/common';
import type { VirtualRun } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';

@Injectable()
export class VirtualRunRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  nextId(): string {
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM virtual_run')!.n + 1;
    return `VV-${String(n).padStart(5, '0')}`;
  }
  insert(r: VirtualRun) {
    this.db.run(
      'INSERT INTO virtual_run (run_id, policy_id, feature_id, feature_version, scenario_id, content_hash, at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      r.runId,
      r.policyId,
      r.featureId,
      r.featureVersion,
      r.scenarioId,
      r.contentHash,
      r.at,
      JSON.stringify(r),
    );
  }
  update(r: VirtualRun) {
    this.db.run('UPDATE virtual_run SET doc = ? WHERE run_id = ?', JSON.stringify(r), r.runId);
  }
  get(id: string): VirtualRun | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM virtual_run WHERE run_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  list(q: { policyId?: string; featureId?: string; featureVersion?: string } = {}): VirtualRun[] {
    const where: string[] = [];
    const params: string[] = [];
    if (q.policyId) (where.push('policy_id = ?'), params.push(q.policyId));
    if (q.featureId) (where.push('feature_id = ?'), params.push(q.featureId));
    if (q.featureVersion) (where.push('feature_version = ?'), params.push(q.featureVersion));
    return this.db.all<{ doc: string }>(`SELECT doc FROM virtual_run ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY run_id DESC`, ...params).map((r) => JSON.parse(r.doc));
  }
  /** 이 정책 내용(contentHash)으로 돌린 시나리오별 최신 실행 */
  latest(policyId: string, scenarioId: string, contentHash: string): VirtualRun | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM virtual_run WHERE policy_id = ? AND scenario_id = ? AND content_hash = ? ORDER BY run_id DESC LIMIT 1', policyId, scenarioId, contentHash);
    return r ? JSON.parse(r.doc) : undefined;
  }
}
