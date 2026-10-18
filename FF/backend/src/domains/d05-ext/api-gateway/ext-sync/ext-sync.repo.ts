// 양방향 연계 저장소 — 외부 항목의 마지막 관측 값(ext_item)·플랫폼 연결(ext_link)·보낼 함(sync_outbox)·받은 함(sync_inbox)·충돌(sync_conflict).
// 보낼 함은 변경과 같은 트랜잭션에서 쌓이고(이벤트 발행 훅), 커밋된 뒤 drain이 외부로 보낸다. 받은 함은 delivery id로 중복을 버린다.
import { Inject, Injectable } from '@nestjs/common';
import type { ExtLink, ExtRef, ExtSystem, LinkEntity, SyncState } from '@ff/contracts';
import { Clock } from '../../../../kernel/clock';
import { DB, type Db } from '../../../../kernel/db';

export type OutboxOp =
  | { op: 'EPIC_MIRROR'; featureId: string; version: string; comment: string | null }
  | { op: 'COMMENT'; key: string; text: string }
  | { op: 'CR_STATUS'; key: string; status: string; comment: string | null }
  | { op: 'CREATE_DEFECT'; featureId: string; version: string; killId: string; title: string; body: string }
  | { op: 'VERIFICATION'; key: string; featureId: string; version: string; gate: string; status: string; evidenceRef: string | null }
  | { op: 'COMMIT_STATUS'; key: string; name: string; state: 'success' | 'failed' | 'pending'; description: string }
  | { op: 'REQ_LINK'; featureId: string; version: string };

export interface OutboxJob {
  jobId: number;
  system: ExtSystem;
  status: 'PENDING' | 'DONE' | 'FAILED' | 'CONFLICT' | 'SKIPPED';
  attempts: number;
  nextAt: string;
  createdAt: string;
  doneAt: string | null;
  error: string | null;
  job: OutboxOp;
}

export interface InboxRow {
  system: ExtSystem;
  deliveryId: string;
  receivedAt: string;
  key: string;
  /** APPLIED(반영) · REJECTED(가드 거부 → 되돌림) · IGNORED(무관·같은 값) · UNMAPPED(외부 계정 매핑 없음) */
  outcome: 'APPLIED' | 'REJECTED' | 'IGNORED' | 'UNMAPPED';
  summary: string;
  externalUser: string;
}

export interface ConflictRow {
  conflictId: number;
  system: ExtSystem;
  key: string;
  field: string;
  platformValue: string;
  externalValue: string;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  resolution: { choose: 'PLATFORM' | 'EXTERNAL'; by: string; at: string; reason: string } | null;
  jobId: number | null;
}

/** 재시도 간격(ms) — 1·2·4·8분 뒤 4번 더, 다섯 번째에도 실패하면 FAILED */
export const OUTBOX_BACKOFF_MS = [60_000, 120_000, 240_000, 480_000];

@Injectable()
export class ExtSyncRepo {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  // ── 외부 항목(마지막 관측 값) ──
  item(system: ExtSystem, key: string): ExtRef | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM ext_item WHERE system = ? AND ext_key = ?', system, key);
    return r ? (JSON.parse(r.doc) as ExtRef) : null;
  }
  putItem(ref: ExtRef) {
    this.db.run('INSERT INTO ext_item (system, ext_key, kind, doc) VALUES (?, ?, ?, ?) ON CONFLICT(system, ext_key) DO UPDATE SET kind = excluded.kind, doc = excluded.doc', ref.system, ref.key, ref.kind, JSON.stringify(ref));
  }
  setState(system: ExtSystem, key: string, syncState: SyncState) {
    const cur = this.item(system, key);
    if (cur) this.putItem({ ...cur, syncState });
  }
  items(system?: ExtSystem, kind?: string): ExtRef[] {
    const where = [system ? 'system = ?' : null, kind ? 'kind = ?' : null].filter(Boolean).join(' AND ');
    const args = [system, kind].filter((x) => !!x) as string[];
    return this.db.all<{ doc: string }>(`SELECT doc FROM ext_item${where ? ` WHERE ${where}` : ''} ORDER BY system, ext_key`, ...args).map((r) => JSON.parse(r.doc) as ExtRef);
  }
  itemCount(): number {
    return this.db.get<{ n: number }>('SELECT count(*) AS n FROM ext_item')!.n;
  }

  // ── 연결 ──
  link(system: ExtSystem, key: string, entity: LinkEntity, entityId: string, by: string) {
    this.db.run('INSERT OR IGNORE INTO ext_link (system, ext_key, entity, entity_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)', system, key, entity, entityId, this.clock.iso(), by);
  }
  linksOf(entity: LinkEntity, entityId: string, system?: ExtSystem): ExtLink[] {
    const rows = this.db.all<{ link_id: number; system: ExtSystem; ext_key: string; entity: LinkEntity; entity_id: string; created_at: string }>(
      `SELECT link_id, system, ext_key, entity, entity_id, created_at FROM ext_link WHERE entity = ? AND entity_id = ?${system ? ' AND system = ?' : ''} ORDER BY system, ext_key`,
      ...(system ? [entity, entityId, system] : [entity, entityId]),
    );
    return rows.flatMap((r) => {
      const it = this.item(r.system, r.ext_key);
      return it ? [{ ...it, linkId: r.link_id, entity: r.entity, entityId: r.entity_id, createdAt: r.created_at }] : [];
    });
  }
  /** 이 외부 항목에 연결된 플랫폼 대상 */
  entitiesOf(system: ExtSystem, key: string, entity?: LinkEntity): { entity: LinkEntity; entityId: string }[] {
    return this.db
      .all<{ entity: LinkEntity; entity_id: string }>(`SELECT entity, entity_id FROM ext_link WHERE system = ? AND ext_key = ?${entity ? ' AND entity = ?' : ''} ORDER BY link_id`, ...(entity ? [system, key, entity] : [system, key]))
      .map((r) => ({ entity: r.entity, entityId: r.entity_id }));
  }
  linkCount(system: ExtSystem): number {
    return this.db.get<{ n: number }>('SELECT count(DISTINCT ext_key) AS n FROM ext_link WHERE system = ?', system)!.n;
  }

  // ── 보낼 함 ──
  enqueue(system: ExtSystem, job: OutboxOp, idemKey: string): boolean {
    const now = this.clock.iso();
    const r = this.db.run('INSERT OR IGNORE INTO sync_outbox (system, idem_key, status, attempts, next_at, created_at, doc) VALUES (?, ?, ?, 0, ?, ?, ?)', system, idemKey, 'PENDING', now, now, JSON.stringify({ job, error: null }));
    return r.changes > 0;
  }
  due(limit = 200): OutboxJob[] {
    return this.db
      .all<{ job_id: number }>("SELECT job_id FROM sync_outbox WHERE status = 'PENDING' AND next_at <= ? ORDER BY job_id LIMIT ?", this.clock.iso(), limit)
      .map((r) => this.job(r.job_id)!);
  }
  job(jobId: number): OutboxJob | null {
    const r = this.db.get<{ job_id: number; system: ExtSystem; status: OutboxJob['status']; attempts: number; next_at: string; created_at: string; done_at: string | null; doc: string }>('SELECT * FROM sync_outbox WHERE job_id = ?', jobId);
    if (!r) return null;
    const d = JSON.parse(r.doc) as { job: OutboxOp; error: string | null };
    return { jobId: r.job_id, system: r.system, status: r.status, attempts: r.attempts, nextAt: r.next_at, createdAt: r.created_at, doneAt: r.done_at, error: d.error, job: d.job };
  }
  finish(j: OutboxJob, status: OutboxJob['status'], error: string | null = null) {
    this.db.run('UPDATE sync_outbox SET status = ?, attempts = ?, done_at = ?, doc = ? WHERE job_id = ?', status, j.attempts + 1, this.clock.iso(), JSON.stringify({ job: j.job, error }), j.jobId);
  }
  retry(j: OutboxJob, error: string) {
    const wait = OUTBOX_BACKOFF_MS[j.attempts];
    if (wait === undefined) return this.finish(j, 'FAILED', error);
    this.db.run('UPDATE sync_outbox SET attempts = ?, next_at = ?, doc = ? WHERE job_id = ?', j.attempts + 1, new Date(this.clock.now().getTime() + wait).toISOString(), JSON.stringify({ job: j.job, error }), j.jobId);
  }
  requeue(jobId: number) {
    this.db.run("UPDATE sync_outbox SET status = 'PENDING', next_at = ? WHERE job_id = ?", this.clock.iso(), jobId);
  }
  jobs(q: { system?: ExtSystem; status?: OutboxJob['status']; limit?: number } = {}): OutboxJob[] {
    const where = [q.system ? 'system = ?' : null, q.status ? 'status = ?' : null].filter(Boolean).join(' AND ');
    const args = [q.system, q.status].filter((x) => !!x) as string[];
    return this.db.all<{ job_id: number }>(`SELECT job_id FROM sync_outbox${where ? ` WHERE ${where}` : ''} ORDER BY job_id DESC LIMIT ?`, ...args, q.limit ?? 200).map((r) => this.job(r.job_id)!);
  }
  countJobs(system: ExtSystem, status: OutboxJob['status']): number {
    return this.db.get<{ n: number }>('SELECT count(*) AS n FROM sync_outbox WHERE system = ? AND status = ?', system, status)!.n;
  }
  lastOutbound(system: ExtSystem): string | null {
    return this.db.get<{ at: string | null }>("SELECT max(done_at) AS at FROM sync_outbox WHERE system = ? AND status = 'DONE'", system)!.at;
  }
  /** 같은 외부 항목에 아직 보내지 않은 작업이 있는가(받은 변경과 엇갈림 판단) */
  pendingFor(system: ExtSystem, key: string): OutboxJob[] {
    return this.jobs({ system, status: 'PENDING', limit: 1000 }).filter((j) => 'key' in j.job && j.job.key === key);
  }

  // ── 받은 함 ──
  seen(system: ExtSystem, deliveryId: string): InboxRow | null {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM sync_inbox WHERE system = ? AND delivery_id = ?', system, deliveryId);
    return r ? (JSON.parse(r.doc) as InboxRow) : null;
  }
  receive(row: InboxRow) {
    this.db.run('INSERT INTO sync_inbox (system, delivery_id, received_at, ext_key, outcome, doc) VALUES (?, ?, ?, ?, ?, ?)', row.system, row.deliveryId, row.receivedAt, row.key, row.outcome, JSON.stringify(row));
  }
  inbox(q: { system?: ExtSystem; outcome?: InboxRow['outcome']; limit?: number } = {}): InboxRow[] {
    const where = [q.system ? 'system = ?' : null, q.outcome ? 'outcome = ?' : null].filter(Boolean).join(' AND ');
    const args = [q.system, q.outcome].filter((x) => !!x) as string[];
    return this.db.all<{ doc: string }>(`SELECT doc FROM sync_inbox${where ? ` WHERE ${where}` : ''} ORDER BY received_at DESC, rowid DESC LIMIT ?`, ...args, q.limit ?? 200).map((r) => JSON.parse(r.doc) as InboxRow);
  }
  countInbox(system: ExtSystem, outcome: InboxRow['outcome']): number {
    return this.db.get<{ n: number }>('SELECT count(*) AS n FROM sync_inbox WHERE system = ? AND outcome = ?', system, outcome)!.n;
  }
  lastInbound(system: ExtSystem): string | null {
    return this.db.get<{ at: string | null }>('SELECT max(received_at) AS at FROM sync_inbox WHERE system = ?', system)!.at;
  }

  // ── 충돌 ──
  openConflict(c: Omit<ConflictRow, 'conflictId' | 'status' | 'createdAt' | 'resolution'>): ConflictRow {
    const createdAt = this.clock.iso();
    const doc = { ...c, status: 'OPEN' as const, createdAt, resolution: null };
    const r = this.db.run('INSERT INTO sync_conflict (system, ext_key, field, status, created_at, doc) VALUES (?, ?, ?, ?, ?, ?)', c.system, c.key, c.field, 'OPEN', createdAt, JSON.stringify(doc));
    return { ...doc, conflictId: Number(r.lastInsertRowid) };
  }
  conflict(id: number): ConflictRow | null {
    const r = this.db.get<{ conflict_id: number; doc: string }>('SELECT conflict_id, doc FROM sync_conflict WHERE conflict_id = ?', id);
    return r ? { ...(JSON.parse(r.doc) as ConflictRow), conflictId: r.conflict_id } : null;
  }
  conflicts(status?: ConflictRow['status']): ConflictRow[] {
    return this.db
      .all<{ conflict_id: number; doc: string }>(`SELECT conflict_id, doc FROM sync_conflict${status ? ' WHERE status = ?' : ''} ORDER BY conflict_id DESC`, ...(status ? [status] : []))
      .map((r) => ({ ...(JSON.parse(r.doc) as ConflictRow), conflictId: r.conflict_id }));
  }
  resolveConflict(c: ConflictRow) {
    this.db.run("UPDATE sync_conflict SET status = 'RESOLVED', doc = ? WHERE conflict_id = ?", JSON.stringify(c), c.conflictId);
  }
  countConflicts(system: ExtSystem): number {
    return this.db.get<{ n: number }>("SELECT count(*) AS n FROM sync_conflict WHERE system = ? AND status = 'OPEN'", system)!.n;
  }
}
