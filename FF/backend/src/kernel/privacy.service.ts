// 개인정보 열람·내보내기·삭제/가명 처리·보존 기한 — 출시 준비 RD-P2-05. 무엇을 어떻게 처리하는지는 contracts/rules/privacy.ts 표 하나가 정한다.
//  · 내보내기(POST /api/privacy/export): 목록의 모든 저장소에서 그 사용자(sub)·차량(VIN)의 행을 JSON으로 — 비밀(세션 해시·개인키)은 뺀다
//  · 삭제 요청(POST /api/privacy/requests) → 다른 보안 담당자가 실행(…/execute, 4안 원칙) 또는 거절(…/reject)
//      DELETE 저장소는 행을 지우고, PSEUDONYMISE 저장소는 식별자를 가명으로 바꾸고(감사 이력은 체인 v2 가명 처리 — 검증 그대로 통과),
//      RETAIN_LEGAL 저장소는 그대로 두고 수만 센다. 차량이면 Data Lake에 가명 단위 삭제를 요청한다(lake-erasure.ts).
//      처리 뒤에는 요청 기록·대응표에서 원래 식별자를 지워 되돌릴 수 없게 한다. 처리 자체도 감사에 남는다(식별자 대신 가명).
//  · 보존 기한(retentionSweep): 끝난 세션 삭제·알림 보존·감사 행위자 식별 가명 처리 — 하루 한 번 운영 보조 정리(housekeeping)가 부른다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post } from '@nestjs/common';
import {
  ErasureExecuteBody,
  ErasureRejectBody,
  ErasureRequestBody,
  isPseudonym,
  mentionsIdentifier,
  PERSONAL_DATA_INVENTORY,
  PERSONAL_RETENTION,
  personalRetentionDays,
  personalStores,
  PrivacyExportBody,
  redactIdentifiers,
  type ErasureResult,
  type PersonalDataStore,
  type PrivacyRequestView,
  type PrivacySubjectKind,
} from '@ff/contracts';
import { randomBytes } from 'node:crypto';
import { AuditAction, CurrentActor, Roles, type Actor } from './actor';
import { AuditService, type RedactionPlan } from './audit.service';
import { Clock } from './clock';
import { vehiclePseudonym } from './crypto';
import { DB, type Db } from './db';
import { DomainError } from './errors';
import { NoReplayStore } from './idempotency.interceptor';
import { lakeErasureConfig, LakeErasureClient } from './lake-erasure';
import { ZodPipe } from './zod.pipe';

type Env = Record<string, string | undefined>;
type Row = Record<string, unknown> & { _rowid: number };

const SYSTEM: Actor = { id: 'system:privacy-retention', role: 'SYSTEM', correlationId: 'privacy-retention' };
const DAY_MS = 24 * 3600_000;
/** 내보내기에서 빼는 칸 — 세션 쿠키 해시·개인키(봉투 암호문)·감사 소금·칸 해시. 개인정보가 아니라 비밀·검증 재료다 */
const EXPORT_EXCLUDED = new Set(['id_hash', 'private_pem', 'salt', 'actor_d', 'target_d', 'reason_d', 'before_d', 'after_d', 'prev_hash', 'hash', 'chain_v']);
/** 목록의 저장소가 실제 표인지 — 시작 때 한 번 확인한다(표 이름을 틀리게 적으면 시험이 잡는다) */
const SPECIAL = new Set(['audit']);

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const asJson = (v: unknown) => {
  if (typeof v !== 'string' || !/^[[{]/.test(v)) return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

/** 개인정보 처리 관문 — 추가 전용 표(감사 수정·소금 삭제·알림 수정/삭제)를 이 트랜잭션 안에서만 연다 */
export function withPrivacyGate<T>(db: Db, fn: () => T): T {
  if (!db.inTransaction) throw new Error('withPrivacyGate는 트랜잭션 안에서 호출해야 합니다');
  db.run('UPDATE privacy_gate SET active = 1 WHERE id = 1');
  try {
    return fn();
  } finally {
    db.run('UPDATE privacy_gate SET active = 0 WHERE id = 1');
  }
}

interface RequestRow {
  request_id: string;
  status: PrivacyRequestView['status'];
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  doc: string;
}

@Injectable()
export class PrivacyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly lake: LakeErasureClient,
  ) {
    const tables = new Set(this.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name));
    const missing = PERSONAL_DATA_INVENTORY.filter((s) => !tables.has(s.store) && !SPECIAL.has(s.store)).map((s) => s.store);
    if (missing.length) throw new Error(`개인정보 목록의 저장소가 DB에 없습니다: ${missing.join(', ')}`);
  }

  /** 목록 + 이 설치의 보존 기한(설정 반영) */
  inventory(env: Env = process.env) {
    return {
      stores: PERSONAL_DATA_INVENTORY,
      retention: PERSONAL_RETENTION.map((p) => ({ ...p, days: personalRetentionDays(p, env) })),
      lake: { configured: !!lakeErasureConfig(env) },
      fourEyes: true,
    };
  }

  /** 찾을 식별자 — 사용자는 sub와 세션에 남은 이메일, 차량은 VIN */
  private needles(kind: PrivacySubjectKind, id: string): string[] {
    if (kind === 'VEHICLE') return [id];
    const emails = this.db.all<{ email: string | null }>('SELECT DISTINCT email FROM auth_session WHERE sub = ?', id).map((r) => r.email).filter((e): e is string => !!e && e.length >= 3);
    return [...new Set([id, ...emails])];
  }

  /** 가명 — 대응표에 있으면 그것, 없으면 새로 만든다(같은 사람은 같은 가명) */
  private pseudonymFor(kind: PrivacySubjectKind, id: string): string {
    const hit = this.db.get<{ pseudonym: string }>('SELECT pseudonym FROM privacy_subject WHERE kind = ? AND subject_id = ?', kind, id);
    if (hit) return hit.pseudonym;
    const pseudonym = `psn-${randomBytes(8).toString('hex')}`;
    this.db.run('INSERT INTO privacy_subject (pseudonym, kind, subject_id, created_at) VALUES (?, ?, ?, ?)', pseudonym, kind, id, this.clock.iso());
    return pseudonym;
  }

  /** 저장소에서 식별자가 든 행 — 같은 값 칸은 =, 글 칸은 LIKE로 거른 뒤 경계가 맞는 식별자만 */
  private rows(store: PersonalDataStore, needles: string[]): Row[] {
    const where: string[] = [];
    const params: string[] = [];
    for (const c of store.idColumns) {
      where.push(`${c} IN (${needles.map(() => '?').join(', ')})`);
      params.push(...needles);
    }
    for (const c of store.textColumns)
      for (const n of needles) {
        where.push(`${c} LIKE ? ESCAPE '\\'`);
        params.push(`%${likeEscape(n)}%`);
      }
    if (!where.length) return [];
    const found = this.db.all<Row>(`SELECT rowid AS _rowid, * FROM ${store.store} WHERE ${where.join(' OR ')}`, ...params);
    return found.filter((r) => store.idColumns.some((c) => needles.includes(String(r[c]))) || store.textColumns.some((c) => mentionsIdentifier(r[c] as string | null, needles)));
  }

  private requestView(r: RequestRow): PrivacyRequestView {
    return JSON.parse(r.doc) as PrivacyRequestView;
  }

  private request(id: string): RequestRow {
    const r = this.db.get<RequestRow>('SELECT * FROM privacy_request WHERE request_id = ?', id);
    if (!r) throw new DomainError('NOT_FOUND', `${id} 요청을 찾을 수 없습니다.`);
    return r;
  }

  private nextRequestId(): string {
    const r = this.db.get<{ m: string | null }>('SELECT max(request_id) AS m FROM privacy_request');
    return `PRV-${String(r?.m ? Number(r.m.slice(4)) + 1 : 1).padStart(5, '0')}`;
  }

  private preview(kind: PrivacySubjectKind, id: string): Record<string, number> {
    const needles = this.needles(kind, id);
    return Object.fromEntries(personalStores(kind).map((s) => [s.store, this.rows(s, needles).length]));
  }

  /** 정보주체 내보내기 — 목록의 모든 저장소 행(비밀 칸 제외). 내보낸 사실은 감사에 가명으로 남는다 */
  export(actor: Actor, body: PrivacyExportBody) {
    const needles = this.needles(body.subjectKind, body.subjectId);
    const sections = personalStores(body.subjectKind).map((s) => ({
      store: s.store,
      category: s.category,
      treatment: s.treatment,
      retention: s.retention,
      basis: s.basis,
      rows: this.rows(s, needles).map(({ _rowid, ...r }) => Object.fromEntries(Object.entries(r).filter(([k]) => !EXPORT_EXCLUDED.has(k)).map(([k, v]) => [k, asJson(v)]))),
    }));
    const counts = Object.fromEntries(sections.map((s) => [s.store, s.rows.length]));
    const pseudonym = this.db.tx(() => {
      const p = this.pseudonymFor(body.subjectKind, body.subjectId);
      this.audit.record(actor, 'PRIVACY_EXPORT', p, { after: { subjectKind: body.subjectKind, counts }, reason: body.reason, componentId: 'KERNEL' });
      return p;
    });
    return {
      schema: 'ff.privacy.export/v1',
      instance: process.env.FF_INSTANCE_ID ?? null,
      generatedAt: this.clock.iso(),
      subject: { kind: body.subjectKind, id: body.subjectId, pseudonym, ...(body.subjectKind === 'VEHICLE' ? { vehiclePseudonym: vehiclePseudonym(body.subjectId) } : {}) },
      sections,
      counts,
    };
  }

  list(): { items: PrivacyRequestView[] } {
    return { items: this.db.all<RequestRow>('SELECT * FROM privacy_request ORDER BY request_id DESC').map((r) => this.requestView(r)) };
  }

  /** 삭제·가명 처리 요청 — 대상 행 수를 미리 세고, 같은 대상의 열린 요청이 있으면 409 */
  createRequest(actor: Actor, body: ErasureRequestBody): PrivacyRequestView {
    if (body.subjectKind === 'USER' && isPseudonym(body.subjectId)) throw new DomainError('VALIDATION', '이미 가명 처리된 식별자입니다.');
    if (body.subjectKind === 'VEHICLE' && body.basis === 'EMPLOYMENT_END') throw new DomainError('VALIDATION', '퇴직(EMPLOYMENT_END)은 사용자 요청에만 쓰는 근거입니다.');
    if (body.subjectKind === 'USER' && body.subjectId === actor.id) throw new DomainError('SEPARATION_OF_DUTY', '자기 자신의 삭제 요청은 다른 담당자가 내야 합니다.');
    const open = this.db.all<RequestRow>("SELECT * FROM privacy_request WHERE status = 'REQUESTED'").map((r) => this.requestView(r));
    if (open.some((r) => r.subjectKind === body.subjectKind && r.subjectId === body.subjectId)) throw new DomainError('CONFLICT', '같은 대상의 처리 대기 요청이 이미 있습니다.');
    const preview = this.preview(body.subjectKind, body.subjectId);
    return this.db.tx(() => {
      const pseudonym = this.pseudonymFor(body.subjectKind, body.subjectId);
      const view: PrivacyRequestView = {
        requestId: this.nextRequestId(),
        subjectKind: body.subjectKind,
        subjectId: body.subjectId,
        pseudonym,
        basis: body.basis,
        reason: body.reason,
        status: 'REQUESTED',
        requestedBy: actor.id,
        requestedAt: this.clock.iso(),
        decidedBy: null,
        decidedAt: null,
        decisionReason: null,
        preview,
        result: null,
      };
      this.db.run('INSERT INTO privacy_request (request_id, status, requested_by, requested_at, doc) VALUES (?, ?, ?, ?, ?)', view.requestId, view.status, view.requestedBy, view.requestedAt, JSON.stringify(view));
      // 감사에는 식별자 대신 가명만 — 요청 기록이 다시 개인정보를 남기지 않게
      this.audit.record(actor, 'PRIVACY_REQUEST', view.requestId, { after: { subjectKind: view.subjectKind, pseudonym, basis: view.basis, preview }, reason: body.reason, componentId: 'KERNEL' });
      return view;
    });
  }

  private decide(actor: Actor, id: string, action: string): { row: RequestRow; view: PrivacyRequestView } {
    const row = this.request(id);
    const view = this.requestView(row);
    if (view.status !== 'REQUESTED') throw new DomainError('CONFLICT', `${id}은(는) 이미 처리됐습니다(${view.status}).`);
    if (view.requestedBy === actor.id) {
      this.audit.denied(actor, action, id, '요청자와 다른 보안 담당자가 처리해야 합니다(4안 원칙)', 'KERNEL');
      throw new DomainError('SEPARATION_OF_DUTY', '요청자와 다른 보안 담당자가 처리해야 합니다.');
    }
    return { row, view };
  }

  /** 실행 — 한 트랜잭션: 삭제·가명 처리·감사 가명 처리·대응표 지움·요청 완료. 커밋 뒤 차량은 Data Lake 삭제 요청 */
  async execute(actor: Actor, id: string): Promise<PrivacyRequestView> {
    const { view } = this.decide(actor, id, 'PRIVACY_ERASE');
    const kind = view.subjectKind;
    const subjectId = view.subjectId!;
    const needles = this.needles(kind, subjectId);
    const pseudonym = view.pseudonym;
    const done = this.db.tx(() =>
      withPrivacyGate(this.db, () => {
        const result: ErasureResult = { deleted: {}, pseudonymised: {}, retained: {}, auditRows: 0, lake: { status: 'NOT_APPLICABLE', lakeRequestId: null, detail: null } };
        for (const s of personalStores(kind)) {
          if (s.store === 'audit') continue;
          const rows = this.rows(s, needles);
          if (s.treatment === 'RETAIN_LEGAL') result.retained[s.store] = rows.length;
          else if (s.treatment === 'DELETE') {
            for (const r of rows) this.db.run(`DELETE FROM ${s.store} WHERE rowid = ?`, r._rowid);
            result.deleted[s.store] = rows.length;
          } else {
            for (const r of rows) {
              const sets: string[] = [];
              const vals: (string | null)[] = [];
              for (const c of s.idColumns)
                if (needles.includes(String(r[c]))) {
                  sets.push(`${c} = ?`);
                  vals.push(pseudonym);
                }
              for (const c of s.textColumns)
                if (typeof r[c] === 'string') {
                  const next = redactIdentifiers(r[c] as string, needles, pseudonym);
                  if (next !== r[c]) {
                    sets.push(`${c} = ?`);
                    vals.push(next);
                  }
                }
              if (sets.length) this.db.run(`UPDATE ${s.store} SET ${sets.join(', ')} WHERE rowid = ?`, ...vals, r._rowid);
            }
            result.pseudonymised[s.store] = rows.length;
          }
        }
        // 감사 이력 — 지우지 않고 식별자만 가명(체인 v2). 사용자만: 차량 기록은 법정 보존이라 감사의 VIN도 그대로 둔다
        if (kind === 'USER') {
          const auditStore = PERSONAL_DATA_INVENTORY.find((s) => s.store === 'audit')!;
          const plan: RedactionPlan = new Map(this.rows(auditStore, needles).map((r) => [Number(r.id), [{ needles, pseudonym }]]));
          const red = this.audit.redactRows(actor, id, plan, { requestId: id, pseudonym, subjectKind: kind });
          result.auditRows = red.rows;
          result.pseudonymised.audit = red.rows;
          if (red.legacyRows) result.retained.audit = red.legacyRows;
        }
        // 대응표(privacy_subject)는 목록의 DELETE 저장소로 지웠다 — 가명을 원래 식별자로 되돌릴 길이 없다
        if (kind === 'VEHICLE') result.lake = { status: 'NOT_CONNECTED', lakeRequestId: null, detail: '커밋 뒤 Data Lake에 보낸다' };
        const next: PrivacyRequestView = { ...view, subjectId: null, status: 'DONE', decidedBy: actor.id, decidedAt: this.clock.iso(), result };
        this.db.run('UPDATE privacy_request SET status = ?, decided_by = ?, decided_at = ?, doc = ? WHERE request_id = ?', next.status, next.decidedBy, next.decidedAt, JSON.stringify(next), id);
        this.audit.record(actor, 'PRIVACY_ERASE', id, { after: { pseudonym, subjectKind: kind, deleted: result.deleted, pseudonymised: result.pseudonymised, retained: result.retained }, componentId: 'KERNEL' });
        return next;
      }),
    );
    if (kind !== 'VEHICLE') return done;
    // Data Lake — 차량 가명 단위 삭제(80-75 §7). 실패해도 FF 쪽 처리는 끝났다 — 결과를 요청 기록에 남기고 다시 보낼 수 있게 한다
    const lake = await this.lake.request({ requestRef: id, pseudonyms: [vehiclePseudonym(subjectId)], basis: view.basis });
    const next: PrivacyRequestView = { ...done, result: { ...done.result!, lake } };
    this.db.tx(() => {
      this.db.run('UPDATE privacy_request SET doc = ? WHERE request_id = ?', JSON.stringify(next), id);
      this.audit.record(actor, 'PRIVACY_LAKE_ERASURE', id, { after: { pseudonym, lake }, componentId: 'KERNEL' });
    });
    return next;
  }

  reject(actor: Actor, id: string, reason: string): PrivacyRequestView {
    const { view } = this.decide(actor, id, 'PRIVACY_REJECT');
    return this.db.tx(() => {
      const next: PrivacyRequestView = { ...view, subjectId: null, status: 'REJECTED', decidedBy: actor.id, decidedAt: this.clock.iso(), decisionReason: reason };
      this.db.run('UPDATE privacy_request SET status = ?, decided_by = ?, decided_at = ?, doc = ? WHERE request_id = ?', next.status, next.decidedBy, next.decidedAt, JSON.stringify(next), id);
      this.audit.record(actor, 'PRIVACY_REJECT', id, { after: { pseudonym: view.pseudonym }, reason, componentId: 'KERNEL' });
      return next;
    });
  }

  /**
   * 개인정보 보존 기한 — 끝난 세션 삭제, 오래된 알림 삭제, 오래된 감사 행의 사람 행위자 식별 가명 처리. 0일이면 그 범주는 건너뛴다.
   * 이벤트 이력(FF_RETENTION_EVENT_DAYS)은 운영 보조 정리(HousekeepingService.sweep)가 지운다.
   */
  retentionSweep(env: Env = process.env): { session: number; notification: number; audit_identity: number } {
    const now = this.clock.now().getTime();
    const days = Object.fromEntries(PERSONAL_RETENTION.map((p) => [p.key, personalRetentionDays(p, env)])) as Record<(typeof PERSONAL_RETENTION)[number]['key'], number>;
    const cutoff = (d: number) => new Date(now - d * DAY_MS).toISOString();
    const out = { session: 0, notification: 0, audit_identity: 0 };
    this.db.tx(() =>
      withPrivacyGate(this.db, () => {
        if (days.session) out.session = this.db.run('DELETE FROM auth_session WHERE expires_at < ?', cutoff(days.session)).changes;
        if (days.notification) {
          const ids = this.db.all<{ notification_id: string }>('SELECT notification_id FROM notification WHERE created_at < ?', cutoff(days.notification)).map((r) => r.notification_id);
          for (const nid of ids) {
            for (const t of ['notification_recipient', 'notification_read', 'notification_exclude']) this.db.run(`DELETE FROM ${t} WHERE notification_id = ?`, nid);
            this.db.run('DELETE FROM notification WHERE notification_id = ?', nid);
          }
          out.notification = ids.length;
        }
        if (days.audit_identity) {
          // 소금이 남은(아직 가명 처리 안 한) v2 행 중 사람 행위자 — 시스템·차량 행위자는 개인이 아니다
          const rows = this.db.all<{ id: number; actor_id: string }>(
            "SELECT a.id, a.actor_id FROM audit a JOIN audit_salt s ON s.audit_id = a.id WHERE a.chain_v = 2 AND a.at < ? AND a.actor_role NOT IN ('SYSTEM', 'VEHICLE') AND a.actor_id NOT LIKE 'psn-%' AND a.action <> 'PRIVACY_REDACT' ORDER BY a.id",
            cutoff(days.audit_identity),
          );
          const plan: RedactionPlan = new Map();
          for (const r of rows) plan.set(r.id, [{ needles: [r.actor_id], pseudonym: this.pseudonymFor('USER', r.actor_id) }]);
          if (plan.size) out.audit_identity = this.audit.redactRows(SYSTEM, 'privacy:retention', plan, { retention: 'audit_identity', days: days.audit_identity }).rows;
        }
      }),
    );
    return out;
  }
}

@Controller('api/privacy')
export class PrivacyController {
  constructor(private readonly s: PrivacyService) {}

  @Get('inventory')
  inventory() {
    return this.s.inventory();
  }

  @Post('export')
  @HttpCode(200)
  @NoReplayStore()
  @Roles('SECURITY_OFFICER')
  @AuditAction('PRIVACY_EXPORT')
  export(@CurrentActor() actor: Actor, @Body(new ZodPipe(PrivacyExportBody)) body: PrivacyExportBody) {
    return this.s.export(actor, body);
  }

  @Get('requests')
  @Roles('SECURITY_OFFICER', 'AUDITOR')
  list() {
    return this.s.list();
  }

  @Post('requests')
  @Roles('SECURITY_OFFICER')
  @AuditAction('PRIVACY_REQUEST')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(ErasureRequestBody)) body: ErasureRequestBody) {
    return this.s.createRequest(actor, body);
  }

  @Post('requests/:id/execute')
  @HttpCode(200)
  @Roles('SECURITY_OFFICER')
  @AuditAction('PRIVACY_ERASE')
  execute(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ErasureExecuteBody)) _body: Record<string, never>) {
    return this.s.execute(actor, id);
  }

  @Post('requests/:id/reject')
  @HttpCode(200)
  @Roles('SECURITY_OFFICER')
  @AuditAction('PRIVACY_REJECT')
  reject(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ErasureRejectBody)) body: { reason: string }) {
    return this.s.reject(actor, id, body.reason);
  }
}
