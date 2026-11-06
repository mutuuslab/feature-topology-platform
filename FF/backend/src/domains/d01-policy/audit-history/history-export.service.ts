// 감사·검증 이력 내보내기와 정책 운영 현황 (D01-10 감사 이력 관리, 기능명세서 B4).
// 내보내기 = 기간 지정 CSV·JSON. 감사는 행마다 체인 해시(앞 해시·자기 해시)를 싣고, 파일 내용 SHA-256을 내보내기 용도 키로 서명한다.
// 민감 값(금액·벤치마크)은 감사에 남길 때부터 가렸고, 파일에서도 같은 키를 다시 가린다. 내보낸 사실도 감사에 남긴다.
import { Controller, Get, Inject, Injectable, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  AUDIT_EXPORT_COLUMNS,
  AUDIT_EXPORT_ROLES,
  canonicalJson,
  csvBody,
  csvFile,
  EXPORT_MAX_ROWS,
  ExportFormat,
  exportSignedPayload,
  fieldChanges,
  maskSensitive,
  periodBounds,
  POLICY_ACTIVITY_ACTIONS,
  VALIDATION_EXPORT_COLUMNS,
  type ExportEnvelope,
  type ExportIntegrity,
  type PolicyActivityStat,
} from '@ff/contracts';
import { CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { sha256hex } from '../../../kernel/crypto';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { singleQuery } from '../../../kernel/paging';
import { PkiService } from '../../d06-qsec/pki-kms/pki.service';

export interface ExportQuery {
  from?: string;
  to?: string;
  format?: string;
  action?: string;
  actorId?: string;
  targetPrefix?: string;
  policyId?: string;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string;
  integrity: ExportIntegrity;
}

/** 표 계산기가 UTF-8 한글을 바로 읽게 하는 BOM — 해시는 BOM·머리 줄 뒤 데이터 줄만 */
const BOM = String.fromCharCode(0xfeff);
const parseJson = (s: string | null) => (s ? (JSON.parse(s) as unknown) : null);

@Injectable()
@PlatformComponent('D01-10')
export class HistoryExportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly pki: PkiService,
  ) {}

  private period(q: ExportQuery) {
    const p = periodBounds(q.from, q.to);
    if (p.error) throw new DomainError('VALIDATION', p.error, { field: 'from' });
    const f = ExportFormat.safeParse(q.format ?? 'csv');
    if (!f.success) throw new DomainError('VALIDATION', `내보내기 형식은 csv 또는 json입니다: ${q.format}`, { field: 'format' });
    return { from: p.from, to: p.to, format: f.data };
  }

  private tooMany(n: number) {
    if (n > EXPORT_MAX_ROWS) throw new DomainError('VALIDATION', `한 파일에 ${EXPORT_MAX_ROWS.toLocaleString('ko-KR')}행까지 내보냅니다(${n.toLocaleString('ko-KR')}행) — 기간을 나눠 받으세요.`, { field: 'from', rows: n });
  }

  /** 파일 만들기 — 내용 SHA-256 → 서명 → CSV(# 머리 줄) 또는 JSON 봉투 */
  private file<T extends Record<string, unknown>>(actor: Actor, kind: 'audit' | 'validations', format: 'csv' | 'json', period: { from: string | null; to: string | null }, filters: Record<string, string>, columns: string[], rows: T[], chain: { from: string | null; to: string | null }): ExportFile {
    const generatedAt = this.clock.iso();
    const body = format === 'csv' ? csvBody(columns, rows) : canonicalJson(rows);
    const sha256 = sha256hex(body);
    const signature = this.pki.sign(exportSignedPayload({ kind, generatedAt, period, rows: rows.length, sha256 }), 'export');
    const integrity: ExportIntegrity = { rows: rows.length, sha256, chainFrom: chain.from, chainTo: chain.to, signature };
    const meta = { kind, generatedAt, generatedBy: actor.id, period, integrity };
    const stamp = generatedAt.slice(0, 19).replace(/[-:T]/g, '');
    const name = `FF_${kind === 'audit' ? 'audit' : 'validations'}_${period.from?.slice(0, 10) ?? 'start'}_${period.to?.slice(0, 10) ?? 'now'}_${stamp}.${format}`;
    if (format === 'csv') return { filename: name, contentType: 'text/csv; charset=utf-8', body: BOM + csvFile(meta, body), integrity };
    const envelope: ExportEnvelope<T> = { kind, generatedAt, generatedBy: actor.id, period, filters, integrity, rows };
    return { filename: name, contentType: 'application/json; charset=utf-8', body: JSON.stringify(envelope, null, 2), integrity };
  }

  /** 내보낸 사실 — 누가·어느 기간·몇 행·파일 해시 */
  private noteExport(actor: Actor, action: string, f: ExportFile, period: { from: string | null; to: string | null }) {
    this.db.tx(() => this.audit.record(actor, action, f.filename, { after: { period, rows: f.integrity.rows, sha256: f.integrity.sha256, keyId: f.integrity.signature.keyId }, componentId: 'D01-10' }));
  }

  /**
   * 감사 이력 내보내기 — 기간·행위·행위자·대상 앞부분 조건, 오래된 순. 행마다 앞 해시·자기 해시(체인 검증과 대조).
   * @req FR-AUD-002-003
   */
  exportAudit(actor: Actor, q: ExportQuery): ExportFile {
    const { from, to, format } = this.period(q);
    const where: string[] = [];
    const params: string[] = [];
    if (from) (where.push('at >= ?'), params.push(from));
    if (to) (where.push('at < ?'), params.push(to));
    if (q.action) (where.push('action = ?'), params.push(q.action));
    if (q.actorId) (where.push('actor_id = ?'), params.push(q.actorId));
    if (q.targetPrefix) (where.push("target LIKE ? ESCAPE '\\'"), params.push(`${q.targetPrefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    this.tooMany(this.db.get<{ n: number }>(`SELECT count(*) AS n FROM audit ${sqlWhere}`, ...params)!.n);
    const raw = this.db.all<any>(`SELECT * FROM audit ${sqlWhere} ORDER BY id ASC`, ...params);
    const rows = raw.map((r) => {
      const rawBefore = parseJson(r.before_doc);
      const rawAfter = parseJson(r.after_doc);
      // 전후 비교는 원래 값으로(가린 값끼리는 같아 보인다) — 민감 키는 fieldChanges가 바뀐 사실만 남긴다
      const changes = rawBefore || rawAfter ? fieldChanges(rawBefore, rawAfter) : [];
      return { id: r.id, at: r.at, actorId: r.actor_id, actorRole: r.actor_role, action: r.action, target: r.target, result: r.result, reason: r.reason ?? null, before: maskSensitive(rawBefore), after: maskSensitive(rawAfter), changes, prevHash: r.prev_hash ?? null, hash: r.hash ?? null };
    });
    const period = { from: from ?? null, to: to ?? null };
    const filters = Object.fromEntries(Object.entries({ action: q.action, actorId: q.actorId, targetPrefix: q.targetPrefix }).filter(([, v]) => !!v)) as Record<string, string>;
    const f = this.file(actor, 'audit', format, period, filters, AUDIT_EXPORT_COLUMNS, rows, { from: rows[0]?.prevHash ?? null, to: rows.at(-1)?.hash ?? null });
    this.noteExport(actor, 'AUDIT_EXPORT', f, period);
    return f;
  }

  /**
   * 검증 이력 내보내기 — 기간·정책 조건, 오래된 순(감사 대응 Export).
   * @req FR-VHM-002-003
   */
  exportValidations(actor: Actor, q: ExportQuery): ExportFile {
    const { from, to, format } = this.period(q);
    const where: string[] = [];
    const params: string[] = [];
    if (from) (where.push('at >= ?'), params.push(from));
    if (to) (where.push('at < ?'), params.push(to));
    if (q.policyId) (where.push('policy_id = ?'), params.push(q.policyId));
    const sqlWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
    this.tooMany(this.db.get<{ n: number }>(`SELECT count(*) AS n FROM validation_run ${sqlWhere}`, ...params)!.n);
    const rows = this.db.all<{ doc: string }>(`SELECT doc FROM validation_run ${sqlWhere} ORDER BY at ASC, run_id ASC`, ...params).map((r) => {
      const v = JSON.parse(r.doc) as { runId: string; at: string; by: string; policyId: string; policyRevision: number; contentHash: string; decision: string; reasons: string[]; results: { componentId: string; result: string; summary?: string }[] };
      return { runId: v.runId, at: v.at, by: v.by, policyId: v.policyId, policyRevision: v.policyRevision, contentHash: v.contentHash, decision: v.decision, reasons: v.reasons ?? [], results: (v.results ?? []).map((x) => ({ componentId: x.componentId, result: x.result, summary: x.summary ?? '' })) };
    });
    const period = { from: from ?? null, to: to ?? null };
    const f = this.file(actor, 'validations', format, period, q.policyId ? { policyId: q.policyId } : {}, VALIDATION_EXPORT_COLUMNS, rows, { from: null, to: null });
    this.noteExport(actor, 'VALIDATION_EXPORT', f, period);
    return f;
  }

  /**
   * 정책 운영 현황 — 정책마다 조회·수정·승인·배포 횟수와 최종 행위 일시(감사 이력 집계).
   * @req FR-AUD-002-001
   */
  policyStats(policyId?: string): PolicyActivityStat[] {
    const actions = Object.values(POLICY_ACTIVITY_ACTIONS).flat();
    const kindOf = new Map(Object.entries(POLICY_ACTIVITY_ACTIONS).flatMap(([k, as]) => as.map((a) => [a, k as keyof typeof POLICY_ACTIVITY_ACTIONS] as const)));
    const ids = policyId ? [policyId] : this.db.all<{ policy_id: string }>('SELECT policy_id FROM policy ORDER BY policy_id').map((r) => r.policy_id);
    const out = new Map<string, PolicyActivityStat>(ids.map((id) => [id, { policyId: id, views: 0, updates: 0, approvals: 0, deploys: 0, lastAt: null, lastAction: null }]));
    const rows = this.db.all<{ target: string; action: string; n: number; last_at: string }>(
      `SELECT target, action, count(*) AS n, max(at) AS last_at FROM audit WHERE result = 'ALLOWED' AND action IN (${actions.map(() => '?').join(',')})${policyId ? ' AND target = ?' : ''} GROUP BY target, action`,
      ...actions,
      ...(policyId ? [policyId] : []),
    );
    for (const r of rows) {
      const s = out.get(r.target);
      const k = kindOf.get(r.action);
      if (!s || !k) continue;
      s[k] += Number(r.n);
      if (!s.lastAt || r.last_at > s.lastAt) [s.lastAt, s.lastAction] = [r.last_at, r.action];
    }
    return [...out.values()];
  }
}

/** 파일 응답 — 이름·형식과 무결성 머리글(파일 안에도 같은 값이 있다) */
function send(res: Response, f: ExportFile) {
  res.setHeader('Content-Type', f.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
  res.setHeader('X-FF-Export-SHA256', f.integrity.sha256);
  res.setHeader('X-FF-Export-Rows', String(f.integrity.rows));
  res.setHeader('X-FF-Export-Signature', `${f.integrity.signature.alg}:${f.integrity.signature.keyId}:${f.integrity.signature.signature}`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(f.body);
}

const q1 = (v: unknown, k: string) => singleQuery(v, k)?.trim() || undefined;

@Controller('api/audit')
export class AuditExportController {
  constructor(private readonly svc: HistoryExportService) {}

  @Get('export')
  @Roles(...AUDIT_EXPORT_ROLES)
  export(@CurrentActor() actor: Actor, @Res() res: Response, @Query('from') from?: unknown, @Query('to') to?: unknown, @Query('format') format?: unknown, @Query('action') action?: unknown, @Query('actorId') actorId?: unknown, @Query('targetPrefix') targetPrefix?: unknown) {
    send(res, this.svc.exportAudit(actor, { from: q1(from, 'from'), to: q1(to, 'to'), format: q1(format, 'format'), action: q1(action, 'action'), actorId: q1(actorId, 'actorId'), targetPrefix: q1(targetPrefix, 'targetPrefix') }));
  }

  @Get('policy-stats')
  policyStats(@Query('policyId') policyId?: unknown) {
    return { items: this.svc.policyStats(q1(policyId, 'policyId')) };
  }
}

@Controller('api/policies/validations')
export class ValidationExportController {
  constructor(private readonly svc: HistoryExportService) {}

  @Get('export')
  @Roles(...AUDIT_EXPORT_ROLES)
  export(@CurrentActor() actor: Actor, @Res() res: Response, @Query('from') from?: unknown, @Query('to') to?: unknown, @Query('format') format?: unknown, @Query('policyId') policyId?: unknown) {
    send(res, this.svc.exportValidations(actor, { from: q1(from, 'from'), to: q1(to, 'to'), format: q1(format, 'format'), policyId: q1(policyId, 'policyId') }));
  }
}
