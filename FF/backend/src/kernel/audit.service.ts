// 감사 이력 관리(D01-10)의 저장 계층. 허용된 변경은 변경과 같은 tx 안에서, 거부·실패는 독립 tx로 남긴다.
// 보고서 v1.1 FFG-PLT-015: 추가 전용 + 해시 체인 — 행마다 hash = sha256(prev_hash ‖ 정규화 내용), 삭제·수정은 DB 트리거가 막는다(012_trust).
// 체인 끝 고정(출시 준비 RD-SEC-13 · FFP-F060) — DB 권한으로 트리거를 지우고 체인 전체를 다시 계산하거나 끝 행을 지우면 체인만으로는 못 잡는다.
//   ① 프로세스가 마지막으로 커밋한 끝(id·hash)을 기억해 검증 때 DB 끝과 맞춘다(끝 행 삭제·바꿔치기)
//   ② FF_AUDIT_KEY(HMAC 키, DB 밖)·FF_AUDIT_ANCHOR_FILE(추가만 하는 파일, 운영은 WORM 볼륨)이 있으면 부팅·주기·종료 때 끝을 서명해 남긴다
//      — 재시작을 넘어 체인 다시 계산을 잡는다. 운영 모드는 둘 다 필수(runtime-config)
//   ③ 운영 모드에서는 hash 없는 행을 채우지 않는다(끼워 넣은 행을 정상으로 만들지 않게) — 검증이 어긋남으로 보고한다
// 체인 v2(출시 준비 RD-P2-05, 마이그레이션 066) — 개인정보 가명 처리가 체인을 깨지 않게 식별 칸(행위자·대상·사유·전후 문서)은
//   행마다 무작위 소금으로 칸 해시(*_d)를 따로 두고, 행 해시는 칸 해시로 잇는다. 소금이 있는 행은 검증이 칸 값 ↔ 칸 해시를 맞춰 본다(칸 변조 = hash).
//   가명 처리(redactRows)는 칸 값만 바꾸고 소금을 지운다 — 행 해시가 그대로라 체인이 통과하고, 소금이 없어 지운 값을 다시 맞혀 볼 수 없다.
//   바꾼 행은 audit_redaction에 바뀐 뒤 내용 해시로, 그 묶음 전체 해시는 체인 안의 처리 기록(PRIVACY_REDACT)에 남는다 — 처리 기록 없이
//   바꾸거나 소금만 지우면 검증이 잡는다(redaction). 소금은 DB 권한자에게 비밀이 아니다 — 위조는 여전히 고정점(②)이 잡는다.
import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { canonicalJson, redactIdentifiers } from '@ff/contracts';
import { sha256hex } from './crypto';
import type { Actor } from './actor';
import { Clock } from './clock';
import { DB, type Db } from './db';
import { isProduction } from './runtime-config';
import { Scheduler } from './scheduler';

export type AuditResult = 'ALLOWED' | 'DENIED' | 'FAILED';

export interface AuditEntry {
  id: number;
  at: string;
  actorId: string;
  actorRole: string;
  action: string;
  target: string;
  result: AuditResult;
  reason: string | null;
  before: unknown;
  after: unknown;
  correlationId: string | null;
  componentId: string | null;
}

export interface AuditQuery {
  target?: string;
  actorId?: string;
  result?: AuditResult;
  limit?: number;
  /** 이 id보다 오래된 것만(최신순 커서) */
  before?: number;
}

export const AUDIT_GENESIS = 'GENESIS';

export interface ChainReport {
  ok: boolean;
  verified: number;
  head: string | null;
  /** 처음 어긋난 행 — 내용이 바뀌었거나(hash) 앞 행과 끊겼다(prev), 기억한 끝과 다르다(head), 서명한 고정점과 다르다(anchor) */
  broken: { id: number; kind: 'hash' | 'prev' | 'head' | 'anchor' | 'redaction' } | null;
  /** DB 밖 고정점 — 파일이 설정됐는가, 확인한 고정점 수, 마지막 고정 시각 */
  anchors: { configured: boolean; checked: number; lastAt: string | null };
}

export interface AuditAnchor {
  at: string;
  id: number;
  hash: string;
  count: number;
  instance: string | null;
  mac: string;
}

/** 고정점 주기 — 기본 60분(FF_AUDIT_ANCHOR_MIN) */
const ANCHOR_MS = () => Math.max(1, Number(process.env.FF_AUDIT_ANCHOR_MIN) || 60) * 60_000;
const anchorMac = (key: string, a: Omit<AuditAnchor, 'mac'>) => createHmac('sha256', key).update(canonicalJson({ at: a.at, id: a.id, hash: a.hash, count: a.count, instance: a.instance })).digest('hex');

/** 체인 v2의 식별 칸 — 가명 처리가 값을 바꿀 수 있는 칸(칸 이름, 열, 칸 해시 열) */
export const REDACTABLE = [
  ['actor', 'actor_id', 'actor_d'],
  ['target', 'target', 'target_d'],
  ['reason', 'reason', 'reason_d'],
  ['before', 'before_doc', 'before_d'],
  ['after', 'after_doc', 'after_d'],
] as const;

/** 칸 해시 — 소금 ‖ 칸 이름 ‖ 값. 빈 칸(null)은 null */
export const fieldDigest = (salt: string, field: string, value: string | null | undefined) => (value === null || value === undefined ? null : sha256hex(`${salt}\n${field}\n${value}`));

/** 가명 처리한 행의 지금 내용 해시 — 처리 묶음(audit_redaction)이 이 값을 기억한다 */
export const redactedDigest = (r: any) => sha256hex(canonicalJson({ id: r.id, actor: r.actor_id, target: r.target, reason: r.reason, before: r.before_doc, after: r.after_doc }));

/** 처리 묶음 해시 — 묶음에 든 (행 id, 내용 해시)를 id 순으로 */
export const redactionBatchDigest = (entries: { id: number; digest: string }[]) =>
  sha256hex(
    [...entries]
      .sort((a, b) => a.id - b.id)
      .map((e) => `${e.id}:${e.digest}`)
      .join('\n'),
  );

/** 가명 처리 계획 — 행마다 바꿀 식별자들과 그 가명 */
export type RedactionPlan = Map<number, { needles: string[]; pseudonym: string }[]>;
export interface RedactionReport {
  /** 바꾼 v2 행 */
  rows: number;
  /** 식별자가 있지만 체인 v1(066 전) 행이라 바꾸지 못한 행 — 체인을 깨지 않으려 그대로 둔다 */
  legacyRows: number;
  /** 처리 기록(감사 행 id) — 바꾼 행이 없으면 null */
  batchId: number | null;
}

/** 해시 입력 — v1: 저장된 열 그대로(JSON 문자열 포함), v2: 식별 칸은 칸 해시로. 키 정렬 */
function chainContent(r: any) {
  if (Number(r.chain_v) === 2)
    return canonicalJson({ v: 2, at: r.at, actorRole: r.actor_role, action: r.action, result: r.result, correlationId: r.correlation_id, componentId: r.component_id, actorD: r.actor_d, targetD: r.target_d, reasonD: r.reason_d, beforeD: r.before_d, afterD: r.after_d });
  return canonicalJson({ at: r.at, actorId: r.actor_id, actorRole: r.actor_role, action: r.action, target: r.target, result: r.result, reason: r.reason, before: r.before_doc, after: r.after_doc, correlationId: r.correlation_id, componentId: r.component_id });
}
export const chainHash = (prev: string, row: unknown) => sha256hex(`${prev}\n${chainContent(row)}`);

@Injectable()
export class AuditService implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  /** 이 프로세스가 마지막으로 커밋을 본 체인 끝 */
  private head: { id: number; hash: string } | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
  ) {}

  /** 해시 체인 도입 전 행(hash 없음)을 id 순으로 채운다 — 트리거는 hash가 비어 있는 행의 갱신만 허용. 운영 모드는 채우지 않는다(③) */
  onModuleInit() {
    this.backfill();
    const tail = this.db.get<{ id: number; hash: string | null }>('SELECT id, hash FROM audit ORDER BY id DESC LIMIT 1');
    this.head = tail?.hash ? { id: tail.id, hash: tail.hash } : null;
  }

  onApplicationBootstrap() {
    this.anchor();
    if (this.scheduler.manual || !this.anchorFile()) return;
    const tick = () => {
      this.anchor();
      this.scheduler.after(ANCHOR_MS(), tick);
    };
    this.scheduler.after(ANCHOR_MS(), tick);
  }

  onApplicationShutdown() {
    this.anchor();
  }

  private anchorFile(): { file: string; key: string } | null {
    const file = process.env.FF_AUDIT_ANCHOR_FILE?.trim();
    const key = process.env.FF_AUDIT_KEY ?? '';
    return file && key ? { file, key } : null;
  }

  /** 지금 끝을 서명해 고정점 파일에 한 줄 더한다(설정이 없거나 체인이 비었으면 아무것도 안 한다). 남긴 고정점을 돌려준다 */
  anchor(): AuditAnchor | null {
    const cfg = this.anchorFile();
    const tail = this.db.get<{ id: number; hash: string | null; n: number }>('SELECT id, hash, (SELECT count(*) FROM audit) AS n FROM audit ORDER BY id DESC LIMIT 1');
    if (!cfg || !tail?.hash) return null;
    const body = { at: this.clock.iso(), id: tail.id, hash: tail.hash, count: tail.n, instance: process.env.FF_INSTANCE_ID ?? null };
    const a: AuditAnchor = { ...body, mac: anchorMac(cfg.key, body) };
    appendFileSync(cfg.file, JSON.stringify(a) + '\n');
    return a;
  }

  private backfill() {
    const todo = this.db.all<any>('SELECT * FROM audit WHERE hash IS NULL ORDER BY id');
    if (!todo.length || isProduction()) return;
    this.db.tx(() => {
      let prev = this.db.get<{ hash: string }>('SELECT hash FROM audit WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1')?.hash ?? AUDIT_GENESIS;
      for (const r of todo) {
        const hash = chainHash(prev, r);
        this.db.run('UPDATE audit SET prev_hash = ?, hash = ? WHERE id = ?', prev, hash, r.id);
        prev = hash;
      }
    });
  }

  /**
   * 체인 검증 — 모든 행의 내용 해시와 앞 행 연결을 다시 계산한다.
   * @rule FFG-PLT-015 — 추가 전용 저장소(트리거)·해시 체인 위변조 검출. 시장 Profile 보존 기간은 WP10에서
   */
  verifyChain(): ChainReport {
    const rows = this.db.all<any>('SELECT * FROM audit ORDER BY id');
    const anchors = this.anchorsReport();
    const fail = (verified: number, head: string | null, id: number, kind: NonNullable<ChainReport['broken']>['kind']): ChainReport => ({ ok: false, verified, head, broken: { id, kind }, anchors: anchors.info });
    const salts = new Map(this.db.all<{ audit_id: number; salt: string }>('SELECT audit_id, salt FROM audit_salt').map((x) => [x.audit_id, x.salt]));
    // 행마다 가장 나중 처리 묶음의 내용 해시, 묶음마다 든 행
    const redacted = new Map<number, { batch: number; digest: string }>();
    const batches = new Map<number, { id: number; digest: string }[]>();
    for (const x of this.db.all<{ audit_id: number; batch_id: number; redacted_digest: string }>('SELECT audit_id, batch_id, redacted_digest FROM audit_redaction ORDER BY batch_id')) {
      redacted.set(x.audit_id, { batch: x.batch_id, digest: x.redacted_digest });
      batches.set(x.batch_id, [...(batches.get(x.batch_id) ?? []), { id: x.audit_id, digest: x.redacted_digest }]);
    }
    let prev = AUDIT_GENESIS;
    for (const [i, r] of rows.entries()) {
      if (r.prev_hash !== prev) return fail(i, prev, r.id, 'prev');
      if (r.hash !== chainHash(prev, r)) return fail(i, prev, r.id, 'hash');
      if (Number(r.chain_v) === 2) {
        const salt = salts.get(r.id);
        if (salt) {
          // 소금이 있으면 칸 값이 칸 해시와 맞아야 한다 — 칸만 고친 변조
          if (REDACTABLE.some(([field, col, dcol]) => r[dcol] !== fieldDigest(salt, field, r[col]))) return fail(i, prev, r.id, 'hash');
        } else {
          // 소금이 없으면 뒤에 오는 처리 묶음이 지금 내용을 기억해야 한다 — 처리 기록 없이 바꾸거나 소금만 지움
          const red = redacted.get(r.id);
          if (!red || red.batch <= r.id || red.digest !== redactedDigest(r)) return fail(i, prev, r.id, 'redaction');
        }
      }
      prev = r.hash;
    }
    // 처리 묶음 — 체인 안의 처리 기록(PRIVACY_REDACT)이 묶음 해시·행 수를 갖는다
    const byId = new Map(rows.map((r) => [r.id as number, r]));
    for (const [batch, entries] of batches) {
      const rec = byId.get(batch);
      let doc: { rows?: number; rowsDigest?: string } | null = null;
      try {
        doc = rec?.action === 'PRIVACY_REDACT' && rec.after_doc ? JSON.parse(rec.after_doc) : null;
      } catch {
        doc = null;
      }
      if (!doc || doc.rows !== entries.length || doc.rowsDigest !== redactionBatchDigest(entries)) return fail(rows.length, prev, batch, 'redaction');
    }
    const end = rows.length ? prev : null;
    const at = new Map(rows.map((r) => [r.id as number, r.hash as string]));
    // ① 기억한 끝 — 그 행이 없거나 hash가 다르면 끝 행을 지웠거나 바꿔치기했다
    if (this.head && at.get(this.head.id) !== this.head.hash) return fail(rows.length, end, this.head.id, 'head');
    // ② 서명한 고정점 — 서명이 틀리거나, 고정한 행이 없거나 hash가 다르면 체인을 다시 계산했다
    if (anchors.broken !== null) return fail(rows.length, end, anchors.broken, 'anchor');
    for (const a of anchors.list) if (at.get(a.id) !== a.hash) return fail(rows.length, end, a.id, 'anchor');
    return { ok: true, verified: rows.length, head: end, broken: null, anchors: anchors.info };
  }

  /** 고정점 파일 읽기 — 서명이 틀린(또는 읽을 수 없는) 첫 줄의 고정 id를 broken으로(-1 = id도 못 읽음) */
  private anchorsReport(): { list: AuditAnchor[]; broken: number | null; info: ChainReport['anchors'] } {
    const cfg = this.anchorFile();
    if (!cfg || !existsSync(cfg.file)) return { list: [], broken: null, info: { configured: !!cfg, checked: 0, lastAt: null } };
    const list: AuditAnchor[] = [];
    let broken: number | null = null;
    for (const line of readFileSync(cfg.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let a: AuditAnchor;
      try {
        a = JSON.parse(line) as AuditAnchor;
      } catch {
        broken ??= -1;
        continue;
      }
      const want = Buffer.from(anchorMac(cfg.key, a));
      const got = Buffer.from(String(a.mac ?? ''));
      if (want.length !== got.length || !timingSafeEqual(want, got)) broken ??= Number(a.id) || -1;
      else list.push(a);
    }
    return { list, broken, info: { configured: true, checked: list.length, lastAt: list.at(-1)?.at ?? null } };
  }

  /** 허용된 변경 기록 — 반드시 변경과 같은 db.tx() 안에서 호출한다. */
  record(actor: Actor, action: string, target: string, change: { before?: unknown; after?: unknown; reason?: string; componentId?: string }) {
    if (!this.db.inTransaction) throw new Error('AuditService.record는 변경과 같은 트랜잭션 안에서 호출해야 합니다');
    this.insert(actor, action, target, 'ALLOWED', change);
  }

  /** 거부 기록 — 변경이 일어나지 않았으므로 독립 트랜잭션. */
  denied(actor: Actor, action: string, target: string, reason: string, componentId?: string) {
    this.write(() => this.insert(actor, action, target, 'DENIED', { reason, componentId }));
  }

  /** 실패 기록 — 변경 tx가 롤백된 뒤 남긴다. */
  failed(actor: Actor, action: string, target: string, reason: string, componentId?: string) {
    this.write(() => this.insert(actor, action, target, 'FAILED', { reason, componentId }));
  }

  /**
   * 식별자 가명 처리 — 개인정보 처리 트랜잭션(privacy_gate 열림) 안에서만. 계획의 행마다 식별 칸의 식별자를 가명으로 바꾸고 소금을 지운 뒤,
   * 바꾼 행의 내용 해시를 묶어 처리 기록(PRIVACY_REDACT, 체인 안)을 남긴다. 처리 기록에는 식별자 대신 가명·행 수·묶음 해시만 적는다.
   * 체인 v1(066 전) 행은 바꾸면 체인이 깨지므로 그대로 두고 수만 센다. 이미 가명 처리한 행도 다시 바꿀 수 있다(묶음마다 내용 해시).
   */
  redactRows(actor: Actor, target: string, plan: RedactionPlan, meta: Record<string, unknown>): RedactionReport {
    if (!this.db.inTransaction) throw new Error('AuditService.redactRows는 개인정보 처리 트랜잭션 안에서 호출해야 합니다');
    if (this.db.get<{ active: number }>('SELECT active FROM privacy_gate WHERE id = 1')?.active !== 1) throw new Error('개인정보 처리 관문(privacy_gate)이 닫혀 있습니다');
    const entries: { id: number; digest: string }[] = [];
    let legacyRows = 0;
    for (const [id, subs] of [...plan].sort((a, b) => a[0] - b[0])) {
      const r = this.db.get<any>('SELECT * FROM audit WHERE id = ?', id);
      if (!r) continue;
      const next: Record<string, string | null> = {};
      for (const [, col] of REDACTABLE) {
        let v: string | null = r[col];
        if (v !== null) for (const sub of subs) v = sub.needles.includes(v) ? sub.pseudonym : redactIdentifiers(v, sub.needles, sub.pseudonym);
        next[col] = v;
      }
      if (REDACTABLE.every(([, col]) => next[col] === r[col])) continue;
      if (Number(r.chain_v) !== 2) {
        legacyRows++;
        continue;
      }
      this.db.run('UPDATE audit SET actor_id = ?, target = ?, reason = ?, before_doc = ?, after_doc = ? WHERE id = ?', next.actor_id, next.target, next.reason, next.before_doc, next.after_doc, id);
      this.db.run('DELETE FROM audit_salt WHERE audit_id = ?', id);
      entries.push({ id, digest: redactedDigest({ ...r, ...next }) });
    }
    if (!entries.length) return { rows: 0, legacyRows, batchId: null };
    this.insert(actor, 'PRIVACY_REDACT', target, 'ALLOWED', { after: { ...meta, rows: entries.length, rowsDigest: redactionBatchDigest(entries), legacyRows }, componentId: 'KERNEL' });
    const batchId = this.db.get<{ id: number }>('SELECT id FROM audit ORDER BY id DESC LIMIT 1')!.id;
    for (const e of entries) this.db.run('INSERT INTO audit_redaction (audit_id, batch_id, redacted_digest) VALUES (?, ?, ?)', e.id, batchId, e.digest);
    return { rows: entries.length, legacyRows, batchId };
  }

  list(q: AuditQuery = {}): AuditEntry[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.before !== undefined) (where.push('id < ?'), params.push(q.before));
    if (q.target) (where.push('target = ?'), params.push(q.target));
    if (q.actorId) (where.push('actor_id = ?'), params.push(q.actorId));
    if (q.result) (where.push('result = ?'), params.push(q.result));
    const sql = `SELECT * FROM audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Math.min(q.limit ?? 200, 1000)}`;
    return this.db.all<any>(sql, ...params).map((r) => ({
      id: r.id,
      at: r.at,
      actorId: r.actor_id,
      actorRole: r.actor_role,
      action: r.action,
      target: r.target,
      result: r.result,
      reason: r.reason,
      before: r.before_doc ? JSON.parse(r.before_doc) : null,
      after: r.after_doc ? JSON.parse(r.after_doc) : null,
      correlationId: r.correlation_id,
      componentId: r.component_id,
    }));
  }

  private write(fn: () => void) {
    // 진행 중인 tx 안에서 호출되면 그 tx가 롤백될 때 함께 사라지므로, 커밋/롤백 이후로 미룰 수 없는 경우를 막는다.
    if (this.db.inTransaction) throw new Error('거부·실패 감사는 트랜잭션 밖에서 기록해야 합니다');
    this.db.tx(fn);
  }

  private insert(actor: Actor, action: string, target: string, result: AuditResult, c: { before?: unknown; after?: unknown; reason?: string; componentId?: string }) {
    const salt = randomBytes(16).toString('hex');
    const row = {
      at: this.clock.iso(),
      actor_id: actor.id,
      actor_role: actor.role,
      action,
      target,
      result,
      reason: c.reason ?? null,
      before_doc: c.before === undefined ? null : JSON.stringify(c.before),
      after_doc: c.after === undefined ? null : JSON.stringify(c.after),
      correlation_id: actor.correlationId ?? null,
      component_id: c.componentId ?? null,
      // 체인 v2 — 식별 칸은 소금 해시로 잇는다(가명 처리가 체인을 깨지 않게)
      chain_v: 2,
      actor_d: null as string | null,
      target_d: null as string | null,
      reason_d: null as string | null,
      before_d: null as string | null,
      after_d: null as string | null,
    };
    for (const [field, col, dcol] of REDACTABLE) row[dcol] = fieldDigest(salt, field, row[col]);
    // 같은 tx 안에서 직전 행의 해시를 이어 받는다(SQLite 쓰기는 직렬화되므로 체인이 갈라지지 않는다)
    const prev = this.db.get<{ hash: string | null }>('SELECT hash FROM audit ORDER BY id DESC LIMIT 1')?.hash ?? AUDIT_GENESIS;
    const { lastInsertRowid } = this.db.run(
      `INSERT INTO audit (at, actor_id, actor_role, action, target, result, reason, before_doc, after_doc, correlation_id, component_id, chain_v, actor_d, target_d, reason_d, before_d, after_d, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?)`,
      row.at,
      row.actor_id,
      row.actor_role,
      row.action,
      row.target,
      row.result,
      row.reason,
      row.before_doc,
      row.after_doc,
      row.correlation_id,
      row.component_id,
      row.actor_d,
      row.target_d,
      row.reason_d,
      row.before_d,
      row.after_d,
      prev,
      chainHash(prev, row),
    );
    this.db.run('INSERT INTO audit_salt (audit_id, salt) VALUES (?, ?)', lastInsertRowid, salt);
    // 커밋된 뒤에만 끝을 옮긴다 — 롤백된 행을 끝으로 기억하지 않게
    const tail = this.db.get<{ id: number; hash: string }>('SELECT id, hash FROM audit ORDER BY id DESC LIMIT 1')!;
    this.db.afterCommit(() => {
      if (!this.head || tail.id > this.head.id) this.head = tail;
    });
  }
}
