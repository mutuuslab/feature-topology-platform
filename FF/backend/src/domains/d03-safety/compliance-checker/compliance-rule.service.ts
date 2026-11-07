// 컴플라이언스 룰 레지스트리 (D03-01, 기능명세서 FR-CRC-001·002) — 등록·조회·수정(Major.Minor 버전)·승인 요청·승인/반려·만료 자동 전환,
// 정책 배포 검증의 적용 룰 선정(승인·유효 기간 안)·배포 시점 재판정 기록·검증 결과 조회. 판정 규칙은 @ff/contracts rules/compliance-rule.
// 수정 권한(명세 비고 "권한 기준 정의 필요")은 D-GAP-1 기본안 — 룰 역할(법규·기능안전·사이버보안) + 소유자(등록자) 본인.
// 승인은 룰에 지정된 승인 대상자 본인만, 작성자·요청자는 승인할 수 없다(작성자≠승인자).
import { Body, Controller, Get, Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  applicableRules,
  bumpRuleVersion,
  canMoveRule,
  CALS,
  ComplianceApprovalRequestBody,
  ComplianceDecisionBody,
  complianceMarketOf,
  COMPLIANCE_RULE_ROLES,
  COMPLIANCE_RULE_STATUSES,
  COMPLIANCE_RULE_TYPES,
  ComplianceScope,
  CreateComplianceRuleBody,
  MARKETS,
  ruleDiff,
  ruleExpired,
  ruleFeatureCandidates,
  UpdateComplianceRuleBody,
  type ApplicableRule,
  type Cal,
  type ComplianceApprovalRequest,
  type ComplianceRegistryInput,
  type ComplianceRule,
  type ComplianceRuleChange,
  type ComplianceRuleContent,
  type ComplianceRuleDetail,
  type ComplianceRuleStatus,
  type ComplianceRuleVersion,
  type FeatureVersionRow,
  type ValidatorResult,
} from '@ff/contracts';
import { CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { PolicyRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo } from '../../d01-policy/repos';

const COMPONENT = 'D03-01';
const SYSTEM: Actor = { id: 'system:compliance-expiry', role: 'SYSTEM', correlationId: '' };
/** 만료는 일 단위지만 재시작·시계 차이를 감안해 한 시간마다 본다(이미 만료된 룰은 다시 바꾸지 않는다) */
export const COMPLIANCE_EXPIRY_SWEEP_MS = 3_600_000;

const csv = (v: unknown) =>
  typeof v === 'string' && v.trim()
    ? v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    : [];
const ListQuery = z
  .object({
    ruleId: z.string().trim().max(32).optional(),
    type: z.enum(COMPLIANCE_RULE_TYPES).optional(),
    market: z.enum(MARKETS).optional(),
    featureId: z.string().regex(/^FEAT-\d{5}$/).optional(),
    status: z.enum(COMPLIANCE_RULE_STATUSES).optional(),
  })
  .strict();
const ValidationQuery = z.object({ policyId: z.string().max(32).optional(), featureId: z.string().regex(/^FEAT-\d{5}$/).optional(), market: z.enum(MARKETS).optional() }).strict();

const parse = <S extends z.ZodTypeAny>(s: S, v: unknown): z.infer<S> => {
  const r = s.safeParse(v);
  if (!r.success) throw new DomainError('VALIDATION', '조회 조건을 확인하세요.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
};

/** 룰 내용만(버전 행에 보존하는 부분) */
const contentOf = (r: ComplianceRuleContent): ComplianceRuleContent => ({
  name: r.name,
  type: r.type,
  scope: r.scope,
  criteria: r.criteria,
  approverIds: r.approverIds,
  evidence: r.evidence,
  validFrom: r.validFrom,
  validTo: r.validTo,
});

/** 컴플라이언스 검증 결과 한 줄 — 정책 검증(VALIDATE, 검증 이력)·배포 시점 재판정(DEPLOY) */
export interface ComplianceCheckView {
  stage: 'VALIDATE' | 'DEPLOY';
  checkId: string;
  policyId: string;
  policyRevision: number;
  featureId: string;
  featureVersion: string;
  market: string;
  at: string;
  by: string;
  result: ValidatorResult['result'];
  /** 정책 검증 종합 판정(GO·HOLD·BLOCKED) — 배포 시점 재판정은 차단(BLOCKED)·통과(GO) */
  decision: string;
  unmet: { ruleId: string | null; item: string | null; message: string }[];
  rules: ApplicableRule[];
}

@Injectable()
@PlatformComponent('D03-01')
export class ComplianceRuleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly features: FeatureRepo,
    private readonly policies: PolicyRepo,
  ) {}

  onApplicationBootstrap() {
    if (process.env.FF_SCHEDULER === 'manual') return;
    this.safeSweep();
    this.timer = setInterval(() => this.safeSweep(), COMPLIANCE_EXPIRY_SWEEP_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private safeSweep() {
    try {
      this.sweep();
    } catch {
      // 한 주기의 실패가 서버를 죽이지 않게 — 다음 주기에 다시 본다
    }
  }

  // ── 저장소 ──
  private all(): ComplianceRule[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM compliance_rule ORDER BY rule_id').map((r) => JSON.parse(r.doc) as ComplianceRule);
  }
  private find(ruleId: string): ComplianceRule | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM compliance_rule WHERE rule_id = ?', ruleId);
    return r ? (JSON.parse(r.doc) as ComplianceRule) : undefined;
  }
  private require(ruleId: string): ComplianceRule {
    const r = this.find(ruleId);
    if (!r) throw new DomainError('NOT_FOUND', `컴플라이언스 룰 ${ruleId}이(가) 없습니다.`);
    return r;
  }
  private save(r: ComplianceRule) {
    this.db.run(
      'INSERT INTO compliance_rule (rule_id, version, status, owner_id, doc) VALUES (?, ?, ?, ?, ?) ON CONFLICT(rule_id) DO UPDATE SET version = excluded.version, status = excluded.status, owner_id = excluded.owner_id, doc = excluded.doc',
      r.ruleId,
      r.version,
      r.status,
      r.ownerId,
      JSON.stringify(r),
    );
  }
  private saveVersion(v: ComplianceRuleVersion) {
    this.db.run(
      'INSERT INTO compliance_rule_version (rule_id, version, status, doc) VALUES (?, ?, ?, ?) ON CONFLICT(rule_id, version) DO UPDATE SET status = excluded.status, doc = excluded.doc',
      v.ruleId,
      v.version,
      v.status,
      JSON.stringify(v),
    );
  }
  private version(ruleId: string, version: string): ComplianceRuleVersion | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM compliance_rule_version WHERE rule_id = ? AND version = ?', ruleId, version);
    return r ? (JSON.parse(r.doc) as ComplianceRuleVersion) : undefined;
  }
  /** 버전 행의 상태·결정 — 내용은 바꾸지 않는다 */
  private markVersion(r: ComplianceRule, status: ComplianceRuleStatus, decision?: { by: string; at: string; reason: string }) {
    const v = this.version(r.ruleId, r.version);
    if (!v) return;
    this.saveVersion({ ...v, status, ...(decision ? { decidedBy: decision.by, decidedAt: decision.at, decisionReason: decision.reason } : {}) });
  }
  private change(r: Pick<ComplianceRule, 'ruleId' | 'version'>, action: ComplianceRuleChange['action'], field: string, before: unknown, after: unknown, by: string, reason: string | null) {
    this.db.run(
      'INSERT INTO compliance_rule_change (rule_id, version, action, field, before_value, after_value, by_actor, at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      r.ruleId,
      r.version,
      action,
      field,
      JSON.stringify(before ?? null),
      JSON.stringify(after ?? null),
      by,
      this.clock.iso(),
      reason,
    );
  }
  private requests(ruleId: string): ComplianceApprovalRequest[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM compliance_approval_request WHERE rule_id = ? ORDER BY request_id DESC', ruleId).map((r) => JSON.parse(r.doc) as ComplianceApprovalRequest);
  }
  private openRequest(ruleId: string): ComplianceApprovalRequest | undefined {
    const r = this.db.get<{ doc: string }>("SELECT doc FROM compliance_approval_request WHERE rule_id = ? AND status = 'OPEN'", ruleId);
    return r ? (JSON.parse(r.doc) as ComplianceApprovalRequest) : undefined;
  }
  private saveRequest(q: ComplianceApprovalRequest) {
    this.db.run(
      'INSERT INTO compliance_approval_request (request_id, rule_id, version, status, doc) VALUES (?, ?, ?, ?, ?) ON CONFLICT(request_id) DO UPDATE SET status = excluded.status, doc = excluded.doc',
      q.requestId,
      q.ruleId,
      q.version,
      q.status,
      JSON.stringify(q),
    );
  }
  private nextRequestId(): string {
    const r = this.db.get<{ m: number | null }>('SELECT max(CAST(substr(request_id, 5) AS INTEGER)) AS m FROM compliance_approval_request');
    return `CRQ-${String((r?.m ?? 0) + 1).padStart(5, '0')}`;
  }

  // ── 입력 확인 ──
  /** 적용 대상 Feature ID는 Registry에 있어야 한다(FR-CRC-001-010) */
  private assertFeatures(featureIds: string[]) {
    const missing = featureIds.filter((id) => !this.features.versions(id).length);
    if (missing.length) throw new DomainError('VALIDATION', `등록되지 않은 Feature입니다: ${missing.join(', ')}`, [{ path: 'scope.featureIds', message: `등록되지 않은 Feature: ${missing.join(', ')}` }]);
  }
  /** 승인 대상자에 작성자(소유자·이번 수정자)를 넣을 수 없다 — 작성자≠승인자 */
  private assertApprovers(approverIds: string[], authors: string[]) {
    const self = approverIds.filter((a) => authors.includes(a));
    if (self.length) throw new DomainError('VALIDATION', '룰 작성자는 승인 대상자가 될 수 없습니다.', [{ path: 'approverIds', message: `작성자 ${self.join(', ')}` }]);
  }

  // ── 조회 ──
  /**
   * 룰 ID·유형·적용 지역·Feature·상태 필터. Feature는 지정 Feature이거나 그 Feature의 판매국이 적용 지역인 룰
   * @req FR-CRC-001-019
   */
  list(q: unknown): ComplianceRule[] {
    const f = parse(ListQuery, q ?? {});
    const feature = f.featureId ? this.features.versions(f.featureId) : [];
    const markets = new Set(feature.map((x) => complianceMarketOf(x.country) as string));
    return this.all().filter(
      (r) =>
        (!f.ruleId || r.ruleId.includes(f.ruleId.toUpperCase())) &&
        (!f.type || r.type === f.type) &&
        (!f.market || (r.scope.markets as string[]).includes(f.market)) &&
        (!f.status || r.status === f.status) &&
        (!f.featureId || (r.scope.featureIds.length ? r.scope.featureIds.includes(f.featureId) : (r.scope.markets as string[]).some((m) => markets.has(m)))),
    );
  }

  detail(ruleId: string): ComplianceRuleDetail {
    const rule = this.require(ruleId);
    const versions = this.db
      .all<{ doc: string }>('SELECT doc FROM compliance_rule_version WHERE rule_id = ?', ruleId)
      .map((r) => JSON.parse(r.doc) as ComplianceRuleVersion)
      .sort((a, b) => cmpVersion(a.version, b.version));
    const changes = this.db
      .all<{ id: number; rule_id: string; version: string; action: ComplianceRuleChange['action']; field: string; before_value: string | null; after_value: string | null; by_actor: string; at: string; reason: string | null }>(
        'SELECT * FROM compliance_rule_change WHERE rule_id = ? ORDER BY id',
        ruleId,
      )
      .map((c) => ({ id: c.id, ruleId: c.rule_id, version: c.version, action: c.action, field: c.field, before: c.before_value == null ? null : JSON.parse(c.before_value), after: c.after_value == null ? null : JSON.parse(c.after_value), by: c.by_actor, at: c.at, reason: c.reason }));
    return { rule, versions, changes, requests: this.requests(ruleId) };
  }

  /**
   * 적용 대상 Feature 후보 — 적용 지역(판매국)·ASIL·지정 Feature
   * @req FR-CRC-001-004
   */
  candidates(q: { markets?: unknown; asil?: unknown; featureIds?: unknown }) {
    const scope = parse(ComplianceScope, { markets: csv(q.markets), asil: csv(q.asil), featureIds: csv(q.featureIds) });
    const items = ruleFeatureCandidates(this.features.all(), scope).map((f) => ({ featureId: f.featureId, version: f.version, name: f.name, country: f.country, asil: f.asil, lifecycle: f.lifecycle, ownerId: f.ownerId }));
    return { items, total: items.length };
  }

  // ── 등록·수정·승인 ──
  /**
   * 등록 — 승인 대기 1.0, 필수 항목·Feature 실재 확인, 룰 ID 중복은 409
   * @req FR-CRC-001-001, FR-CRC-001-010, FR-CRC-001-011, FR-CRC-001-012, FR-CRC-001-013, FR-CRC-001-022
   */
  create(actor: Actor, body: CreateComplianceRuleBody): ComplianceRule {
    if (this.find(body.ruleId)) {
      this.audit.failed(actor, 'COMPLIANCE_RULE_CREATE', body.ruleId, '룰 ID 중복', COMPONENT);
      throw new DomainError('CONFLICT', `룰 ID ${body.ruleId}이(가) 이미 있습니다 — 다른 ID를 쓰세요.`);
    }
    this.assertFeatures(body.scope.featureIds);
    this.assertApprovers(body.approverIds, [actor.id]);
    const now = this.clock.iso();
    const content = contentOf(body);
    const rule: ComplianceRule = { ruleId: body.ruleId, ...content, version: '1.0', status: 'PROPOSED', ownerId: actor.id, createdBy: actor.id, createdAt: now, updatedBy: actor.id, updatedAt: now, decidedBy: null, decidedAt: null, retiredAt: null };
    return this.db.tx(() => {
      this.save(rule);
      this.saveVersion({ ruleId: rule.ruleId, version: '1.0', status: 'PROPOSED', content, createdBy: actor.id, createdAt: now, decidedBy: null, decidedAt: null, decisionReason: null });
      this.change(rule, 'CREATE', 'status', null, 'PROPOSED', actor.id, body.reason ?? null);
      this.audit.record(actor, 'COMPLIANCE_RULE_CREATE', rule.ruleId, { after: { version: rule.version, status: rule.status, ...content }, reason: body.reason, componentId: COMPONENT });
      this.events.publish('compliance.rule.created', rule.ruleId, { ruleId: rule.ruleId, version: rule.version, type: rule.type, markets: rule.scope.markets }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return rule;
    });
  }

  /**
   * 수정 — 소유자 본인만(FR-CRC-001-020, D-GAP-1 기본안). 바뀐 항목에 따라 Major/Minor 증가, 이전 버전 행은 그대로(FR-CRC-001-023·024),
   * 승인된 룰은 승인 대기로(FR-CRC-001-021), 항목별 전후 값을 이력에(FR-CRC-001-022). 열린 승인 요청은 철회된다(대상 버전이 바뀐다).
   * @req FR-CRC-001-020, FR-CRC-001-021, FR-CRC-001-022, FR-CRC-001-023, FR-CRC-001-024
   */
  update(actor: Actor, ruleId: string, body: UpdateComplianceRuleBody): ComplianceRule {
    const cur = this.require(ruleId);
    if (cur.ownerId !== actor.id) {
      this.audit.failed(actor, 'COMPLIANCE_RULE_UPDATE', ruleId, `소유자(${cur.ownerId})가 아닌 수정 시도`, COMPONENT);
      throw new DomainError('FORBIDDEN', `이 룰은 소유자 ${cur.ownerId}만 수정할 수 있습니다.`);
    }
    if (!canMoveRule(cur.status, 'PROPOSED')) throw new DomainError('CONFLICT', '만료된 룰은 수정할 수 없습니다 — 새 룰을 등록하세요.');
    const { reason, ...patch } = body;
    const scope = patch.scope ? ComplianceScope.parse(patch.scope) : cur.scope;
    const next: ComplianceRuleContent = { ...contentOf(cur), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), scope };
    if (next.validTo && next.validTo < next.validFrom) throw new DomainError('VALIDATION', '유효 종료일은 유효 시작일보다 빠를 수 없습니다.', [{ path: 'validTo', message: '종료일 < 시작일' }]);
    this.assertFeatures(next.scope.featureIds);
    this.assertApprovers(next.approverIds, [cur.ownerId, actor.id]);
    const diff = ruleDiff(contentOf(cur), next);
    if (!diff.length) throw new DomainError('CONFLICT', '바뀐 항목이 없습니다.');
    const version = bumpRuleVersion(cur.version, diff);
    const now = this.clock.iso();
    const rule: ComplianceRule = { ...cur, ...next, version, status: 'PROPOSED', updatedBy: actor.id, updatedAt: now, decidedBy: null, decidedAt: null };
    return this.db.tx(() => {
      this.save(rule);
      this.saveVersion({ ruleId, version, status: 'PROPOSED', content: next, createdBy: actor.id, createdAt: now, decidedBy: null, decidedAt: null, decisionReason: null });
      for (const d of diff) this.change(rule, 'UPDATE', d.field, d.before, d.after, actor.id, reason);
      if (cur.status !== 'PROPOSED') this.change(rule, 'UPDATE', 'status', cur.status, 'PROPOSED', actor.id, reason);
      const open = this.openRequest(ruleId);
      if (open) this.saveRequest({ ...open, status: 'WITHDRAWN', decidedAt: now, reason: `버전 ${version}으로 수정되어 철회` });
      this.audit.record(actor, 'COMPLIANCE_RULE_UPDATE', ruleId, { before: { version: cur.version, status: cur.status }, after: { version, status: 'PROPOSED', changes: diff }, reason, componentId: COMPONENT });
      this.events.publish('compliance.rule.updated', ruleId, { ruleId, from: cur.version, version, level: diff.some((d) => d.level === 'MAJOR') ? 'MAJOR' : 'MINOR', fields: diff.map((d) => d.field) }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return rule;
    });
  }

  /**
   * 승인 요청 — 요청자·대상 룰 버전·승인 대상자·요청 일시. 승인 대기 룰만, 열린 요청은 하나
   * @req FR-CRC-001-014
   */
  requestApproval(actor: Actor, ruleId: string, body: ComplianceApprovalRequestBody): ComplianceApprovalRequest {
    const r = this.require(ruleId);
    if (r.status !== 'PROPOSED') throw new DomainError('CONFLICT', `${r.status} 룰은 승인 요청 대상이 아닙니다 — 수정하면 다시 승인 대기가 됩니다.`);
    if (this.openRequest(ruleId)) throw new DomainError('CONFLICT', '이미 열린 승인 요청이 있습니다.');
    const q: ComplianceApprovalRequest = { requestId: this.nextRequestId(), ruleId, version: r.version, requestedBy: actor.id, approverIds: [...r.approverIds], requestedAt: this.clock.iso(), note: body.note ?? null, status: 'OPEN', decidedBy: null, decidedAt: null, reason: null };
    return this.db.tx(() => {
      this.saveRequest(q);
      this.change(r, 'REQUEST', 'approvalRequest', null, { requestId: q.requestId, approverIds: q.approverIds }, actor.id, q.note);
      this.audit.record(actor, 'COMPLIANCE_RULE_REQUEST', ruleId, { after: { requestId: q.requestId, version: q.version, approverIds: q.approverIds }, reason: q.note ?? undefined, componentId: COMPONENT });
      this.events.publish('compliance.rule.approval-requested', ruleId, { ruleId, name: r.name, version: r.version, requestId: q.requestId, requestedBy: actor.id, approverIds: q.approverIds }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return q;
    });
  }

  /**
   * 승인·반려 — 열린 요청의 지정 승인 대상자 본인만, 작성자·요청자 제외. 상태·승인자·일시·룰 버전 저장
   * @req FR-CRC-001-015, FR-CRC-001-022
   */
  decide(actor: Actor, ruleId: string, body: ComplianceDecisionBody): ComplianceRule {
    const r = this.require(ruleId);
    const q = this.openRequest(ruleId);
    const action = body.decision === 'APPROVE' ? 'COMPLIANCE_RULE_APPROVE' : 'COMPLIANCE_RULE_REJECT';
    if (r.status !== 'PROPOSED' || !q) throw new DomainError('CONFLICT', '열린 승인 요청이 없습니다 — 먼저 승인을 요청하세요.');
    if ([r.ownerId, r.updatedBy, q.requestedBy].includes(actor.id)) {
      this.audit.failed(actor, action, ruleId, '작성자·요청자 본인 승인 시도', COMPONENT);
      throw new DomainError('SEPARATION_OF_DUTY', '룰 작성자·승인 요청자는 승인할 수 없습니다.');
    }
    if (!q.approverIds.includes(actor.id)) {
      this.audit.failed(actor, action, ruleId, `지정 승인 대상자(${q.approverIds.join(', ')})가 아님`, COMPONENT);
      throw new DomainError('FORBIDDEN', `이 룰의 승인 대상자(${q.approverIds.join(', ')})만 결정할 수 있습니다.`);
    }
    const status: ComplianceRuleStatus = body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const now = this.clock.iso();
    const next: ComplianceRule = { ...r, status, decidedBy: actor.id, decidedAt: now };
    return this.db.tx(() => {
      this.save(next);
      this.markVersion(next, status, { by: actor.id, at: now, reason: body.reason });
      this.saveRequest({ ...q, status, decidedBy: actor.id, decidedAt: now, reason: body.reason });
      this.change(next, body.decision === 'APPROVE' ? 'APPROVE' : 'REJECT', 'status', r.status, status, actor.id, body.reason);
      this.audit.record(actor, action, ruleId, { before: { status: r.status }, after: { status, version: r.version, requestId: q.requestId }, reason: body.reason, componentId: COMPONENT });
      this.events.publish(body.decision === 'APPROVE' ? 'compliance.rule.approved' : 'compliance.rule.rejected', ruleId, { ruleId, version: r.version, by: actor.id }, { componentId: COMPONENT, correlationId: actor.correlationId });
      return next;
    });
  }

  // ── 만료 ──
  /** 관련 Feature Owner 팀 — 지정 Feature, 없으면 적용 범위의 Feature 후보 */
  private ownerTeams(r: ComplianceRule): string[] {
    const fs = r.scope.featureIds.length ? r.scope.featureIds.flatMap((id) => this.features.versions(id)) : ruleFeatureCandidates(this.features.all(), r.scope);
    return [...new Set(fs.map((f) => f.ownerId).filter(Boolean))].sort();
  }

  /**
   * 종료일이 기준일보다 이전인 룰을 Retired로 — 이력·감사·만료 알림. 바꾼 수
   * @req FR-CRC-001-025, FR-CRC-001-026, FR-CRC-001-022
   */
  sweep(): number {
    const today = this.clock.iso().slice(0, 10);
    let n = 0;
    for (const r of this.all()) {
      if (r.status === 'RETIRED' || !ruleExpired(r, today)) continue;
      const now = this.clock.iso();
      const next: ComplianceRule = { ...r, status: 'RETIRED', retiredAt: now };
      this.db.tx(() => {
        this.save(next);
        this.markVersion(next, 'RETIRED');
        const open = this.openRequest(r.ruleId);
        if (open) this.saveRequest({ ...open, status: 'WITHDRAWN', decidedAt: now, reason: '유효 종료일이 지나 만료' });
        this.change(next, 'RETIRE', 'status', r.status, 'RETIRED', SYSTEM.id, `유효 종료일 ${r.validTo} 지남`);
        this.audit.record(SYSTEM, 'COMPLIANCE_RULE_RETIRE', r.ruleId, { before: { status: r.status }, after: { status: 'RETIRED', version: r.version }, reason: `유효 종료일 ${r.validTo} 지남`, componentId: COMPONENT });
        this.events.publish(
          'compliance.rule.expired',
          r.ruleId,
          { ruleId: r.ruleId, name: r.name, type: r.type, markets: r.scope.markets, validTo: r.validTo, expiredAt: now, version: r.version, authorId: r.ownerId, approverIds: r.approverIds, ownerTeams: this.ownerTeams(r) },
          { componentId: COMPONENT },
        );
      });
      n++;
    }
    return n;
  }

  // ── 배포 검증 연계 ──
  /** TARA 사이버보안 보증 수준(CAL) — 이 Feature Version의 가장 늦은 TARA 기록에서 가장 높은 값(Security 등급). 없으면 null */
  calOf(featureId: string, version: string): Cal | null {
    const rows = this.db.all<{ doc: string }>("SELECT doc FROM analysis_record WHERE feature_id = ? AND feature_version = ? AND kind = 'TARA' ORDER BY signed_at, record_id", featureId, version);
    const last = rows.length ? (JSON.parse(rows[rows.length - 1].doc) as { content?: { threats?: { cal?: string }[] } }) : null;
    const cals = (last?.content?.threats ?? []).map((t) => t.cal).filter((c): c is Cal => (CALS as readonly string[]).includes(c ?? ''));
    return cals.length ? [...cals].sort().at(-1)! : null;
  }

  /** 배포 검증 입력 — 룰 전부(판정 함수가 범위·승인·유효 기간으로 고른다)·대상 지역·CAL·검증 시각 */
  registryFor(feature: Pick<FeatureVersionRow, 'featureId' | 'version' | 'country'>, at = this.clock.iso()): ComplianceRegistryInput {
    return { rules: this.all(), market: complianceMarketOf(feature.country), cal: this.calOf(feature.featureId, feature.version), at };
  }

  /**
   * 정책 하나에 적용할 룰 — Feature·대상 지역·배포 유형·Safety/Security 등급·배포 시점
   * @req FR-CRC-002-001, FR-CRC-002-002, FR-CRC-002-003
   */
  applicable(policyId: unknown, at?: unknown) {
    if (typeof policyId !== 'string' || !policyId) throw new DomainError('VALIDATION', 'policyId가 필요합니다.');
    const p = this.policies.get(policyId);
    if (!p) throw new DomainError('NOT_FOUND', `정책 ${policyId}이(가) 없습니다.`);
    const f = this.features.get(p.featureId, p.featureVersion);
    if (!f) throw new DomainError('NOT_FOUND', `정책 대상 ${p.featureId} ${p.featureVersion}이(가) Registry에 없습니다.`);
    const when = typeof at === 'string' && at ? at : this.clock.iso();
    if (Number.isNaN(Date.parse(when))) throw new DomainError('VALIDATION', 'at은 ISO 시각이어야 합니다.');
    const reg = this.registryFor(f, when);
    const ctx = { featureId: f.featureId, market: reg.market, rolloutMode: p.rollout.mode, asil: f.asil, cal: reg.cal };
    return { policyId, featureId: f.featureId, featureVersion: f.version, ...ctx, at: when, rules: applicableRules(reg.rules, ctx, when) };
  }

  /**
   * 배포 시점 재판정 기록(추가만) — 차단이면 미충족 룰 ID·항목·사유를 남긴다
   * @req FR-CRC-002-007
   */
  recordDeployCheck(actor: Actor, policy: { policyId: string; revision: number; featureId: string; featureVersion: string }, market: string, result: ValidatorResult): ComplianceCheckView {
    const at = this.clock.iso();
    const view: ComplianceCheckView = {
      stage: 'DEPLOY',
      checkId: '',
      policyId: policy.policyId,
      policyRevision: policy.revision,
      featureId: policy.featureId,
      featureVersion: policy.featureVersion,
      market,
      at,
      by: actor.id,
      result: result.result,
      decision: result.result === 'FAIL' ? 'BLOCKED' : 'GO',
      unmet: unmetOf(result),
      rules: result.rules ?? [],
    };
    const r = this.db.run('INSERT INTO compliance_check (policy_id, stage, result, at, doc) VALUES (?, ?, ?, ?, ?)', policy.policyId, 'DEPLOY', result.result === 'FAIL' ? 'FAIL' : 'PASS', at, JSON.stringify(view));
    return { ...view, checkId: `CHK-${r.lastInsertRowid}` };
  }

  /**
   * 검증 결과 조회 — 배포(정책) ID·Feature ID·대상 지역. 정책 검증 이력의 D03-01 결과 + 배포 시점 재판정, 늦은 것 먼저
   * @req FR-CRC-002-008
   */
  validations(q: unknown): { items: ComplianceCheckView[] } {
    const f = parse(ValidationQuery, q ?? {});
    const runs = this.policies.runs(f.policyId);
    const out: (ComplianceCheckView & { seq: number })[] = [];
    for (const run of runs) {
      const p = this.policies.get(run.policyId);
      const d03 = run.results.find((x) => x.componentId === 'D03-01');
      if (!p || !d03) continue;
      const feature = this.features.get(p.featureId, p.featureVersion);
      out.push({
        stage: 'VALIDATE',
        checkId: run.runId,
        policyId: run.policyId,
        policyRevision: run.policyRevision,
        featureId: p.featureId,
        featureVersion: p.featureVersion,
        market: complianceMarketOf(feature?.country ?? 'OTHER'),
        at: run.at,
        by: run.by,
        result: d03.result,
        decision: run.decision,
        unmet: unmetOf(d03),
        rules: d03.rules ?? [],
        seq: 0,
      });
    }
    const checks = f.policyId
      ? this.db.all<{ id: number; doc: string }>('SELECT id, doc FROM compliance_check WHERE policy_id = ? ORDER BY id DESC', f.policyId)
      : this.db.all<{ id: number; doc: string }>('SELECT id, doc FROM compliance_check ORDER BY id DESC LIMIT 200');
    for (const c of checks) out.push({ ...(JSON.parse(c.doc) as ComplianceCheckView), checkId: `CHK-${c.id}`, seq: c.id });
    const items = out
      .filter((x) => (!f.featureId || x.featureId === f.featureId) && (!f.market || x.market === f.market))
      // 같은 시각이면 배포 시점 재판정이 뒤에 일어난 일이다(검증 → 승인 → 배포)
      .sort((a, b) => b.at.localeCompare(a.at) || (b.stage === 'DEPLOY' ? 1 : 0) - (a.stage === 'DEPLOY' ? 1 : 0) || b.seq - a.seq || b.checkId.localeCompare(a.checkId))
      .map(({ seq: _seq, ...x }) => x);
    return { items };
  }
}

const cmpVersion = (a: string, b: string) => {
  const [am, an] = a.split('.').map(Number);
  const [bm, bn] = b.split('.').map(Number);
  return am - bm || an - bn;
};

const unmetOf = (r: ValidatorResult) => r.findings.filter((x) => x.result === 'FAIL').map((x) => ({ ruleId: x.ruleId ?? null, item: x.item ?? null, message: x.message }));

@Controller('api/compliance-rules')
export class ComplianceRuleController {
  constructor(private readonly svc: ComplianceRuleService) {}

  @Get()
  list(@Query() q: Record<string, unknown>) {
    return { items: this.svc.list(q) };
  }

  @Get('feature-candidates')
  candidates(@Query('markets') markets?: unknown, @Query('asil') asil?: unknown, @Query('featureIds') featureIds?: unknown) {
    if (!markets) throw new DomainError('VALIDATION', 'markets가 필요합니다.');
    return this.svc.candidates({ markets, asil, featureIds });
  }

  @Get('applicable')
  applicable(@Query('policyId') policyId?: unknown, @Query('at') at?: unknown) {
    return this.svc.applicable(policyId, at);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Post()
  @Roles(...COMPLIANCE_RULE_ROLES)
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateComplianceRuleBody)) body: CreateComplianceRuleBody) {
    return this.svc.create(actor, body);
  }

  @Patch(':id')
  @Roles(...COMPLIANCE_RULE_ROLES)
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(UpdateComplianceRuleBody)) body: UpdateComplianceRuleBody) {
    return this.svc.update(actor, id, body);
  }

  @Post(':id/approval-requests')
  @Roles(...COMPLIANCE_RULE_ROLES)
  request(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ComplianceApprovalRequestBody)) body: ComplianceApprovalRequestBody) {
    return this.svc.requestApproval(actor, id, body);
  }

  @Post(':id/decision')
  @Roles(...COMPLIANCE_RULE_ROLES)
  decide(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ComplianceDecisionBody)) body: ComplianceDecisionBody) {
    return this.svc.decide(actor, id, body);
  }
}

@Controller('api/compliance-validations')
export class ComplianceValidationController {
  constructor(private readonly svc: ComplianceRuleService) {}

  @Get()
  list(@Query() q: Record<string, unknown>) {
    return this.svc.validations(q);
  }
}
