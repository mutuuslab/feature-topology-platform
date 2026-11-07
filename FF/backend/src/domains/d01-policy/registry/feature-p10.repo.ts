// Lifecycle 보강 저장소(P10, D01-01) — 반려·재작업 기록(추가만, 241), 즉시 폐기 요청, Retired 전이 관문 사실.
import { Inject, Injectable } from '@nestjs/common';
import type { FeatureRetireRequest, FeatureReviewRecord, RetirementGateFacts } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';
import { PolicyRepo } from '../policy-repos';

const pad = (n: number) => String(n).padStart(5, '0');

@Injectable()
export class FeatureReviewRepo {
  constructor(@Inject(DB) private readonly db: Db) {}
  list(featureId: string, version?: string): FeatureReviewRecord[] {
    const rows = version
      ? this.db.all<{ doc: string }>('SELECT doc FROM feature_review_record WHERE feature_id = ? AND version = ? ORDER BY at, record_id', featureId, version)
      : this.db.all<{ doc: string }>('SELECT doc FROM feature_review_record WHERE feature_id = ? ORDER BY at, record_id', featureId);
    return rows.map((r) => JSON.parse(r.doc));
  }
  nextId(): string {
    return `FRV-${pad((this.db.get<{ n: number }>('SELECT count(*) AS n FROM feature_review_record')?.n ?? 0) + 1)}`;
  }
  insert(r: FeatureReviewRecord) {
    this.db.run('INSERT INTO feature_review_record (record_id, feature_id, version, kind, at, doc) VALUES (?, ?, ?, ?, ?, ?)', r.recordId, r.featureId, r.version, r.kind, r.at, JSON.stringify(r));
  }
}

@Injectable()
export class FeatureRetireRepo {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policies: PolicyRepo,
  ) {}
  get(id: string): FeatureRetireRequest | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM feature_retire_request WHERE request_id = ?', id);
    return r ? JSON.parse(r.doc) : undefined;
  }
  list(q: { featureId?: string; status?: string } = {}): FeatureRetireRequest[] {
    const where: string[] = [];
    const args: string[] = [];
    if (q.featureId) (where.push('feature_id = ?'), args.push(q.featureId));
    if (q.status) (where.push('status = ?'), args.push(q.status));
    return this.db.all<{ doc: string }>(`SELECT doc FROM feature_retire_request ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY request_id DESC`, ...args).map((r) => JSON.parse(r.doc));
  }
  pending(featureId: string, version: string): FeatureRetireRequest | undefined {
    const r = this.db.get<{ doc: string }>("SELECT doc FROM feature_retire_request WHERE feature_id = ? AND version = ? AND status = 'PENDING'", featureId, version);
    return r ? JSON.parse(r.doc) : undefined;
  }
  nextId(): string {
    return `FRT-${pad((this.db.get<{ n: number }>('SELECT count(*) AS n FROM feature_retire_request')?.n ?? 0) + 1)}`;
  }
  insert(r: FeatureRetireRequest) {
    this.db.run('INSERT INTO feature_retire_request (request_id, feature_id, version, status, doc) VALUES (?, ?, ?, ?, ?)', r.requestId, r.featureId, r.version, r.status, JSON.stringify(r));
  }
  update(r: FeatureRetireRequest) {
    this.db.run('UPDATE feature_retire_request SET status = ?, doc = ? WHERE request_id = ?', r.status, JSON.stringify(r), r.requestId);
  }

  /** Retired 전이 관문 사실 — 이 Version의 배포 중 정책 Flag, 그 Flag들의 Registry 퇴역 전 Retirement 건(FR-REG-005-017·018) */
  retirementFacts(featureId: string, version: string): RetirementGateFacts {
    const mine = this.policies.forFeature(featureId, version);
    const deployedFlags = [...new Set(mine.filter((p) => p.status === 'DEPLOYED').map((p) => p.flagKey))].sort();
    const keys = [...new Set(mine.map((p) => p.flagKey))];
    const openRetirements = keys.length
      ? this.db
          .all<{ retirement_id: string; flag_key: string; status: string; doc: string }>(`SELECT retirement_id, flag_key, status, doc FROM flag_retirement WHERE status IN ('REQUESTED','APPROVED') AND flag_key IN (${keys.map(() => '?').join(',')}) ORDER BY retirement_id`, ...keys)
          .filter((r) => (JSON.parse(r.doc) as { featureVersion?: string }).featureVersion === version)
          .map((r) => ({ retirementId: r.retirement_id, flagKey: r.flag_key, status: r.status }))
      : [];
    return { deployedFlags, openRetirements };
  }
}
