// Lifecycle 보강(P10, D01-01) — 정의 승인 반려, 즉시 폐기 요청·승인, Feature 변경 이력 조회.
// 전이 규칙은 contracts(lifecycle·feature-retire), 상태 적용·감사는 LifecycleService. 여기서는 요청·기록·조회를 맡는다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Query } from '@nestjs/common';
import {
  FEATURE_RETIRE_REQUESTERS,
  immediateRetireBlockers,
  periodBounds,
  RejectFeatureBody,
  RetireDecisionBody,
  RetireFeatureBody,
  type FeatureRetireRequest,
  type GateRecordRow,
} from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { singleQuery } from '../../../kernel/paging';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { FeatureRepo } from '../repos';
import { FeatureRetireRepo, FeatureReviewRepo } from './feature-p10.repo';
import { LifecycleService } from './lifecycle.service';

/** 감사 before/after에서 바뀐 항목(최상위 키) — 변경 이력의 '변경 항목' */
function changedItems(before: unknown, after: unknown): string[] {
  const b = before && typeof before === 'object' && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
  const a = after && typeof after === 'object' && !Array.isArray(after) ? (after as Record<string, unknown>) : {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).sort();
}

@Injectable()
@PlatformComponent('D01-01')
export class FeatureP10Service {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly features: FeatureRepo,
    private readonly lifecycle: LifecycleService,
    private readonly reviews: FeatureReviewRepo,
    private readonly retire: FeatureRetireRepo,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  private requireFeature(featureId: string) {
    const vs = this.features.versions(featureId);
    if (!vs.length) throw new DomainError('NOT_FOUND', `${featureId}은(는) 등록되지 않은 Feature입니다.`);
    return vs;
  }

  // ── 정의 승인 반려 ─────────────────────────────────────────────
  /** @req FR-REG-002-010 FR-REG-002-011 — PROPOSED에 머물고 반려 기록(사유·반려자·일시·이슈 항목·재작업 사유). 작성자는 반려할 수 없다 */
  reject(actor: Actor, featureId: string, version: string, body: RejectFeatureBody) {
    const f = this.lifecycle.require(featureId, version);
    const target = `${featureId}@${version}`;
    const fail = (code: 'GUARD_FAILED' | 'SEPARATION_OF_DUTY', msg: string): never => {
      this.audit.failed(actor, 'FEATURE_REJECT', target, msg, 'D01-01');
      throw new DomainError(code, msg);
    };
    if (f.lifecycle !== 'PROPOSED') fail('GUARD_FAILED', `${f.lifecycle} 버전은 정의 승인 반려 대상이 아닙니다 — 정의 승인을 기다리는(PROPOSED) Version만 반려합니다.`);
    if (this.features.meta(featureId, version).createdBy === actor.id) fail('SEPARATION_OF_DUTY', '작성자는 자기 Feature 버전을 반려할 수 없습니다.');
    return this.db.tx(() => this.lifecycle.recordReview(actor, f, 'REJECT', 'PROPOSED', body.reason, body.issues, body.reworkReason));
  }

  reviewList(featureId: string, version?: string) {
    this.requireFeature(featureId);
    return { items: this.reviews.list(featureId, version) };
  }

  // ── 즉시 폐기 ─────────────────────────────────────────────
  /** @req FR-REG-002-014 FR-REG-002-015 — 어느 단계에서든 폐기 요청(사유·요청자). 승인 전에는 바뀌지 않는다 */
  requestRetire(actor: Actor, featureId: string, version: string, body: RetireFeatureBody): FeatureRetireRequest {
    const f = this.lifecycle.require(featureId, version);
    const target = `${featureId}@${version}`;
    if (f.lifecycle === 'RETIRED') {
      this.audit.failed(actor, 'FEATURE_RETIRE_REQUEST', target, '이미 RETIRED', 'D01-01');
      throw new DomainError('GUARD_FAILED', '이미 RETIRED 버전입니다.');
    }
    if (this.retire.pending(featureId, version)) throw new DomainError('CONFLICT', '같은 버전의 폐기 요청이 이미 승인을 기다립니다.');
    const r: FeatureRetireRequest = {
      requestId: this.retire.nextId(),
      featureId,
      version,
      from: f.lifecycle,
      reason: body.reason,
      status: 'PENDING',
      requestedBy: actor.id,
      requestedRole: actor.role,
      requestedAt: this.clock.iso(),
      decidedBy: null,
      decidedRole: null,
      decidedAt: null,
      decisionReason: null,
    };
    return this.db.tx(() => {
      this.retire.insert(r);
      this.audit.record(actor, 'FEATURE_RETIRE_REQUEST', target, { after: { requestId: r.requestId, from: r.from }, reason: r.reason, componentId: 'D01-01' });
      this.events.publish('feature.retire.requested', target, { requestId: r.requestId, featureId, version, from: r.from, by: actor.id }, { componentId: 'D01-01', correlationId: actor.correlationId });
      return r;
    });
  }

  /** @req FR-REG-002-016 FR-REG-005-017 FR-REG-005-018 — 승인자 확인(요청자·작성자 제외), 출시된 적 있으면 Retired 관문, 승인하면 RETIRED */
  decideRetire(actor: Actor, requestId: string, body: RetireDecisionBody) {
    const r = this.retire.get(requestId);
    if (!r) throw new DomainError('NOT_FOUND', `${requestId} 폐기 요청을 찾을 수 없습니다.`);
    const f = this.lifecycle.require(r.featureId, r.version);
    const target = `${r.featureId}@${r.version}`;
    const action = `FEATURE_RETIRE_${body.decision}`;
    const blockers = immediateRetireBlockers({ lifecycle: f.lifecycle, request: r, actor, createdBy: this.features.meta(r.featureId, r.version).createdBy, gate: this.retire.retirementFacts(r.featureId, r.version) });
    // 반려는 승인 역할·직무 분리만 본다(관문 미통과도 반려할 수 있다)
    const relevant = body.decision === 'APPROVE' ? blockers : blockers.filter((b) => b.code !== 'RETIREMENT_INCOMPLETE');
    if (relevant.length) {
      const msg = relevant.map((b) => b.message).join('; ');
      this.audit.failed(actor, action, target, msg, 'D01-01');
      const code = relevant.some((b) => b.code === 'SEPARATION_OF_DUTY') ? 'SEPARATION_OF_DUTY' : relevant.some((b) => b.code === 'ROLE') ? 'FORBIDDEN' : relevant.some((b) => b.code === 'CONFLICT') ? 'CONFLICT' : 'GUARD_FAILED';
      throw new DomainError(code, `폐기할 수 없습니다: ${msg}`, { blockers: relevant });
    }
    return this.db.tx(() => {
      const next: FeatureRetireRequest = { ...r, status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', decidedBy: actor.id, decidedRole: actor.role, decidedAt: this.clock.iso(), decisionReason: body.reason };
      this.retire.update(next);
      this.audit.record(actor, action, target, { before: { status: 'PENDING', lifecycle: f.lifecycle }, after: { status: next.status, requestedBy: r.requestedBy }, reason: body.reason, componentId: 'D01-01' });
      const feature = body.decision === 'APPROVE' ? this.lifecycle.applyRetire(actor, f, `즉시 폐기 ${r.requestId} — ${r.reason} (요청 ${r.requestedBy}, 승인 ${actor.id})`) : f;
      return { request: next, feature };
    });
  }

  retireRequests(q: { featureId?: string; status?: string }) {
    return { items: this.retire.list(q) };
  }

  // ── 변경 이력 ─────────────────────────────────────────────
  /** @req FR-REG-003-002 FR-REG-003-003 — Feature ID의 변경 이력(없는 ID는 NOT_FOUND), 변경자·기간·변경 항목으로 검색(일치 없음은 빈 목록) */
  history(featureId: string, q: { actorId?: unknown; from?: unknown; to?: unknown; item?: unknown; version?: unknown }) {
    this.requireFeature(featureId);
    const actorId = singleQuery(q.actorId, 'actorId')?.trim() || undefined;
    const item = singleQuery(q.item, 'item')?.trim() || undefined;
    const version = singleQuery(q.version, 'version')?.trim() || undefined;
    const period = periodBounds(singleQuery(q.from, 'from'), singleQuery(q.to, 'to'));
    if (period.error) throw new DomainError('VALIDATION', period.error, { field: 'from' });
    const audited = this.audit
      .list({ targetPrefix: featureId, actorId, from: period.from, to: period.to, result: 'ALLOWED', limit: 1000 })
      .filter((e) => e.target === featureId || e.target.startsWith(`${featureId}@`) || e.target.startsWith(`${featureId}:`))
      .map((e) => {
        const ver = e.target.startsWith(`${featureId}@`) ? e.target.slice(featureId.length + 1).split('#')[0] : null;
        const items = changedItems(e.before, e.after);
        return { id: String(e.id), source: 'AUDIT' as const, at: e.at, actorId: e.actorId, actorRole: e.actorRole, action: e.action, target: e.target, version: ver, items, reason: e.reason, before: e.before, after: e.after };
      });
    // 이관 기록(감사 도입 전 판정·확정) — Gate 판정 기록·Baseline 확정을 같은 이력에 넣는다(감사에 같은 기록이 있으면 빼고)
    const seenGates = new Set(audited.map((e) => (e.after as { gateRecordId?: string } | null)?.gateRecordId).filter(Boolean));
    const seenBaselines = new Set(audited.map((e) => (e.after as { baselineId?: string } | null)?.baselineId).filter(Boolean));
    const inPeriod = (at: string | null) => !!at && (!period.from || Date.parse(at) >= Date.parse(period.from)) && (!period.to || Date.parse(at) < Date.parse(period.to));
    const recorded = this.features.versions(featureId).flatMap((v) => [
      ...this.db
        .all<{ doc: string }>('SELECT doc FROM gate_record WHERE feature_id = ? AND feature_version = ? ORDER BY judged_at, gate_record_id', featureId, v.version)
        .map((r) => JSON.parse(r.doc) as GateRecordRow)
        .filter((g) => !seenGates.has(g.gateRecordId))
        .map((g) => ({ id: g.gateRecordId, source: 'RECORD' as const, at: g.judgedAt, actorId: g.judgeRole, actorRole: null, action: `GATE_JUDGE ${g.gate}`, target: `${featureId}@${v.version}#${g.gate}`, version: v.version, items: ['status'], reason: `${g.status} — ${g.rationale}`, before: null, after: { gateRecordId: g.gateRecordId, status: g.status, evidenceRef: g.evidenceRef } })),
      ...this.db
        .all<{ baseline_id: string; approved_by: string | null; approved_at: string | null }>('SELECT baseline_id, approved_by, approved_at FROM baseline WHERE feature_id = ? AND version = ?', featureId, v.version)
        .filter((b) => !seenBaselines.has(b.baseline_id) && b.approved_at)
        .map((b) => ({ id: b.baseline_id, source: 'RECORD' as const, at: b.approved_at!, actorId: b.approved_by ?? 'BOM 승인자', actorRole: null, action: 'BASELINE_APPROVE', target: `${featureId}@${v.version}`, version: v.version, items: ['baselineId'], reason: `Baseline ${b.baseline_id} 확정`, before: null, after: { baselineId: b.baseline_id } })),
    ]).filter((e) => (!actorId || e.actorId === actorId) && inPeriod(e.at));
    const rows = [...audited, ...recorded]
      .filter((e) => (!version || e.version === version) && (!item || e.items.includes(item) || e.action.includes(item)))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
    return { featureId, filter: { actorId: actorId ?? null, from: period.from ?? null, to: period.to ?? null, item: item ?? null, version: version ?? null }, items: rows };
  }
}

@Controller('api/features')
export class FeatureP10Controller {
  constructor(private readonly svc: FeatureP10Service) {}

  @Get(':id/history')
  history(@Param('id') id: string, @Query('actorId') actorId?: unknown, @Query('from') from?: unknown, @Query('to') to?: unknown, @Query('item') item?: unknown, @Query('version') version?: unknown) {
    return this.svc.history(id, { actorId, from, to, item, version });
  }

  @Get(':id/reviews')
  reviews(@Param('id') id: string, @Query('version') version?: string) {
    return this.svc.reviewList(id, version || undefined);
  }

  @Post(':id/versions/:ver/rejection')
  @HttpCode(201)
  @Roles('FEATURE_APPROVER')
  @AuditAction('FEATURE_REJECT')
  reject(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(RejectFeatureBody)) body: RejectFeatureBody) {
    return this.svc.reject(actor, id, ver, body);
  }

  @Post(':id/versions/:ver/retire-requests')
  @HttpCode(201)
  @Roles(...FEATURE_RETIRE_REQUESTERS)
  @AuditAction('FEATURE_RETIRE_REQUEST')
  requestRetire(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('ver') ver: string, @Body(new ZodPipe(RetireFeatureBody)) body: RetireFeatureBody) {
    return this.svc.requestRetire(actor, id, ver, body);
  }
}

@Controller('api/feature-retire-requests')
export class FeatureRetireController {
  constructor(private readonly svc: FeatureP10Service) {}

  @Get()
  list(@Query('featureId') featureId?: string, @Query('status') status?: string) {
    return this.svc.retireRequests({ featureId: featureId || undefined, status: status || undefined });
  }

  @Post(':rid/decision')
  @HttpCode(200)
  @Roles('FEATURE_APPROVER', 'RELEASE_MANAGER')
  @AuditAction('FEATURE_RETIRE_DECISION')
  decide(@CurrentActor() actor: Actor, @Param('rid') rid: string, @Body(new ZodPipe(RetireDecisionBody)) body: RetireDecisionBody) {
    return this.svc.decideRetire(actor, rid, body);
  }
}
