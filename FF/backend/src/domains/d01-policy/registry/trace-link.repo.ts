// Feature 추적 연결 저장소(P3) — 연결(해제는 상태로 남김)과 Test Case별 Test Evidence(추가만, 171_feature_trace_link).
import { Inject, Injectable } from '@nestjs/common';
import type { TestEvidenceRow, TraceKind, TraceLinkRow, TraceLinkStatus } from '@ff/contracts';
import { DB, type Db } from '../../../kernel/db';

const parse = <T>(rows: { doc: string }[]): T[] => rows.map((r) => JSON.parse(r.doc) as T);
const pad = (n: number) => String(n).padStart(5, '0');

@Injectable()
export class TraceLinkRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  get(linkId: string): TraceLinkRow | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM feature_trace_link WHERE link_id = ?', linkId);
    return r ? JSON.parse(r.doc) : undefined;
  }
  list(q: { featureId?: string; kind?: TraceKind; status?: TraceLinkStatus } = {}): TraceLinkRow[] {
    const where: string[] = [];
    const args: string[] = [];
    if (q.featureId) (where.push('feature_id = ?'), args.push(q.featureId));
    if (q.kind) (where.push('kind = ?'), args.push(q.kind));
    if (q.status) (where.push('status = ?'), args.push(q.status));
    return parse<TraceLinkRow>(this.db.all(`SELECT doc FROM feature_trace_link ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY link_id`, ...args));
  }
  activeFor(featureId: string, kind: TraceKind, elementId: string): TraceLinkRow | undefined {
    const r = this.db.get<{ doc: string }>("SELECT doc FROM feature_trace_link WHERE feature_id = ? AND kind = ? AND element_id = ? AND status = 'ACTIVE'", featureId, kind, elementId);
    return r ? JSON.parse(r.doc) : undefined;
  }
  count(): number {
    return this.db.get<{ n: number }>('SELECT count(*) AS n FROM feature_trace_link')!.n;
  }
  nextId(): string {
    const r = this.db.get<{ m: number | null }>('SELECT max(CAST(substr(link_id, 5) AS INTEGER)) AS m FROM feature_trace_link');
    return `TRL-${pad((r?.m ?? 0) + 1)}`;
  }
  insert(l: TraceLinkRow) {
    this.db.run('INSERT INTO feature_trace_link (link_id, feature_id, kind, element_id, status, doc) VALUES (?, ?, ?, ?, ?, ?)', l.linkId, l.featureId, l.kind, l.elementId, l.status, JSON.stringify(l));
  }
  update(l: TraceLinkRow) {
    this.db.run('UPDATE feature_trace_link SET status = ?, doc = ? WHERE link_id = ?', l.status, JSON.stringify(l), l.linkId);
  }

  evidence(q: { featureId?: string; linkId?: string } = {}): TestEvidenceRow[] {
    if (q.linkId) return parse(this.db.all('SELECT doc FROM trace_test_evidence WHERE link_id = ? ORDER BY record_id', q.linkId));
    if (q.featureId) return parse(this.db.all('SELECT doc FROM trace_test_evidence WHERE feature_id = ? ORDER BY record_id', q.featureId));
    return parse(this.db.all('SELECT doc FROM trace_test_evidence ORDER BY record_id'));
  }
  hasEvidence(linkId: string, evidenceId: string): boolean {
    return !!this.db.get('SELECT 1 FROM trace_test_evidence WHERE link_id = ? AND evidence_id = ?', linkId, evidenceId);
  }
  nextEvidenceId(): string {
    const r = this.db.get<{ m: number | null }>('SELECT max(CAST(substr(record_id, 5) AS INTEGER)) AS m FROM trace_test_evidence');
    return `TEV-${pad((r?.m ?? 0) + 1)}`;
  }
  insertEvidence(e: TestEvidenceRow) {
    this.db.run('INSERT INTO trace_test_evidence (record_id, link_id, feature_id, evidence_id, executed_at, result, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', e.recordId, e.linkId, e.featureId, e.evidenceId, e.executedAt, e.result, JSON.stringify(e));
  }
}
