// 예외 정책·임시 우회·Gate PENDING 예외 (D03-02 배포 안전성 검증의 예외 층, GX — FR-EXC-001·002, FR-REG-005-010, FR-RDD-001-006).
// Gate·검증 판정(FFG-LCY-002 fail-closed)은 그대로 두고 그 위에 얹는 층이다: 2인 승인(요청자≠승인자, 두 승인자 서로 다름)으로 ACTIVE가 된 예외만,
// 기록된 제한 범위(제한 배포·Pilot)까지 배포를 연다. 만료 일시는 필수(무기한 없음)이고, 만료·회수되면 적용 이전의 정책 상태로 원복하고 원복 메시지를 알린다.
// 우회 불가 4가지(서명·무결성, 긴급 차단 2인 승인, 직무 분리, 멈추기)는 요청 단계에서 거부한다. 규칙은 contracts rules/exception-policy.ts.
import { Body, Controller, Get, HttpCode, Inject, Injectable, OnApplicationBootstrap, Param, Post, Query } from '@nestjs/common';
import {
  CreateExceptionBody,
  EXCEPTION_APPROVER_ROLES,
  EXCEPTION_KIND_LABEL,
  EXCEPTION_REQUEST_ROLES,
  EXCEPTION_REQUIRED_APPROVALS,
  EXCEPTION_RESTRICTION_LABEL,
  EXCEPTION_STATUS_LABEL,
  ExceptionDecisionBody,
  ExceptionRevokeBody,
  RESTRICTION_CAP_BP,
  approvalProblems,
  checkLabel,
  exceptionActive,
  exceptionDue,
  exceptionWaiver,
  finalExpiry,
  gatePendingProblems,
  releaseGateDecision,
  requestProblems,
  type ExceptionCheckId,
  type ExceptionPolicy,
  type ExceptionStatus,
  type GateId,
  type GateStatus,
  type Policy,
  type ReleaseGateDecision,
} from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { Scheduler } from '../../../kernel/scheduler';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { PolicyRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo, GateRepo } from '../../d01-policy/repos';
import { GateDecisionService } from '../../d01-policy/topology/gate-decision.service';
import { SecureDeployService } from '../../d06-qsec/secure-deploy/secure-deploy.service';

const SYSTEM: Actor = { id: 'system:exception', role: 'SYSTEM', correlationId: 'exception-expiry' };
/** 만료 확인 주기 — 예약 작업(FR-EXC-002-003). 확인은 쓰는 쪽(배포 검사·조회)에서도 매번 한다 */
const SWEEP_MS = 60_000;
const OPEN: ExceptionStatus[] = ['REQUESTED', 'APPROVING', 'ACTIVE'];

/** 예외 저장소 — 문서 하나 + 상태 전이 기록(추가만) */
@Injectable()
export class ExceptionRepo {
  constructor(@Inject(DB) private readonly db: Db) {}

  all(): ExceptionPolicy[] {
    return this.db.all<{ doc: string }>('SELECT doc FROM exception_policy ORDER BY exception_id').map((r) => JSON.parse(r.doc) as ExceptionPolicy);
  }
  get(id: string): ExceptionPolicy | undefined {
    const r = this.db.get<{ doc: string }>('SELECT doc FROM exception_policy WHERE exception_id = ?', id);
    return r ? (JSON.parse(r.doc) as ExceptionPolicy) : undefined;
  }
  nextId(): string {
    const n = this.db.get<{ n: number }>('SELECT count(*) AS n FROM exception_policy')!.n;
    return `EXC-${String(n + 1).padStart(5, '0')}`;
  }
  save(e: ExceptionPolicy) {
    this.db.run(
      'INSERT INTO exception_policy (exception_id, kind, feature_id, feature_version, policy_id, status, expires_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(exception_id) DO UPDATE SET status = excluded.status, expires_at = excluded.expires_at, doc = excluded.doc',
      e.exceptionId,
      e.kind,
      e.featureId,
      e.featureVersion,
      e.policyId,
      e.status,
      e.expiresAt,
      JSON.stringify(e),
    );
  }
  log(id: string, at: string, kind: string, actorId: string, doc: Record<string, unknown>) {
    this.db.run('INSERT INTO exception_policy_event (exception_id, at, kind, actor_id, doc) VALUES (?, ?, ?, ?, ?)', id, at, kind, actorId, JSON.stringify(doc));
  }
  events(id: string) {
    return this.db
      .all<{ at: string; kind: string; actor_id: string; doc: string }>('SELECT at, kind, actor_id, doc FROM exception_policy_event WHERE exception_id = ? ORDER BY id', id)
      .map((r) => ({ at: r.at, kind: r.kind, actorId: r.actor_id, ...(JSON.parse(r.doc) as Record<string, unknown>) }));
  }
}

/** 배포 한 번의 예외 층 — policy.service deploy가 검사마다 묻는다. 쓴 예외와 효력 상한을 모아 적용 기록을 남긴다 */
export interface DeployExceptionGate {
  release: ReleaseGateDecision;
  /** 출시 전 Version은 Shadow만 — 덮는 Gate 예외가 없으면 거부(다른 배포 검사 뒤에 본다: 앞선 검사의 사유를 가리지 않게) */
  assertRelease(): void;
  /** 이 검사가 막았을 때 적용 중 임시 우회가 덮으면 true(사용 기록) */
  waive(check: ExceptionCheckId, err?: unknown): boolean;
  /** 예외로 연 효력 상한 — 쓴 예외가 없으면 null */
  cap(): number | null;
  /** 배포 트랜잭션 안 — 쓴 예외에 적용 기록(이전 배포 상태)을 남기고 정책에 제한 범위를 붙인다 */
  applied(actor: Actor, next: Policy, prev: Policy | undefined): Policy;
  used(): string[];
}

@Injectable()
@PlatformComponent('D03-02')
export class ExceptionPolicyService implements OnApplicationBootstrap {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly repo: ExceptionRepo,
    private readonly clock: Clock,
    private readonly scheduler: Scheduler,
    private readonly policies: PolicyRepo,
    private readonly features: FeatureRepo,
    private readonly gates: GateRepo,
    private readonly decisions: GateDecisionService,
    private readonly secureDeploy: SecureDeployService,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  /** 만료 확인 예약 작업(FR-EXC-002-003) — 1분마다. 시험(FF_SCHEDULER=manual)은 sweep()을 직접 부른다 */
  onApplicationBootstrap() {
    if (this.scheduler.manual) return;
    const tick = () => {
      try {
        this.sweep();
      } catch {
        // 다음 주기에 다시 본다 — 배포 검사는 만료 일시를 매번 직접 본다
      }
      this.scheduler.after(SWEEP_MS, tick);
    };
    this.scheduler.after(SWEEP_MS, tick);
  }

  private now() {
    return this.clock.iso();
  }

  private latestGates(featureId: string, version: string): Partial<Record<GateId, GateStatus>> {
    const latest = this.gates.latest(featureId, version);
    return Object.fromEntries(Object.entries(latest).map(([g, r]) => [g, r?.status])) as Partial<Record<GateId, GateStatus>>;
  }

  /**
   * 목록 — active=true면 지금 적용 중인 예외만(없으면 빈 목록)
   * @req FR-EXC-001-003
   */
  list(q: { status?: string; featureId?: string; featureVersion?: string; policyId?: string; active?: string } = {}) {
    this.sweep();
    const now = this.now();
    const items = this.repo
      .all()
      .filter((e) => !q.status || e.status === q.status)
      .filter((e) => !q.featureId || e.featureId === q.featureId)
      .filter((e) => !q.featureVersion || e.featureVersion === q.featureVersion)
      .filter((e) => !q.policyId || e.policyId === q.policyId || e.applications.some((a) => a.policyId === q.policyId))
      .filter((e) => q.active !== 'true' || exceptionActive(e, now))
      .reverse();
    return { items: items.map((e) => this.view(e, now)), active: items.filter((e) => exceptionActive(e, now)).length };
  }

  private view(e: ExceptionPolicy, now: string) {
    return {
      ...e,
      kindLabel: EXCEPTION_KIND_LABEL[e.kind],
      statusLabel: EXCEPTION_STATUS_LABEL[e.status],
      restrictionLabel: EXCEPTION_RESTRICTION_LABEL[e.restriction],
      capBasisPoints: RESTRICTION_CAP_BP[e.restriction],
      active: exceptionActive(e, now),
      remainingMs: e.expiresAt && exceptionActive(e, now) ? Date.parse(e.expiresAt) - Date.parse(now) : null,
      scope: this.scopeText(e),
    };
  }

  private scopeText(e: ExceptionPolicy) {
    return e.kind === 'GATE_PENDING' ? `PENDING Gate ${e.gates.join('·')}` : e.checks.map((c) => (c === 'COMPLIANCE_RULE' ? `${checkLabel(c)}(${e.ruleIds.join(', ')})` : checkLabel(c))).join(' · ');
  }

  require(id: string): ExceptionPolicy {
    const e = this.repo.get(id);
    if (!e) throw new DomainError('NOT_FOUND', `예외 ${id}을(를) 찾을 수 없습니다.`);
    return e;
  }

  detail(id: string) {
    this.sweep();
    const e = this.require(id);
    return { ...this.view(e, this.now()), history: this.repo.events(id) };
  }

  /**
   * 승인 요청 등록 — 요청자·긴급 사유·대상 Feature·적용 기간·우회할 검사(우회 불가 4가지 거부), Gate 예외는 제한 조건·완료 예정일·잔여 리스크
   * @req FR-EXC-001-001, FR-REG-005-010
   */
  create(actor: Actor, body: CreateExceptionBody) {
    const target = `${body.featureId}@${body.featureVersion}`;
    const refuse = (code: 'GUARD_FAILED' | 'NOT_FOUND', msg: string, problems?: unknown): never => {
      this.audit.failed(actor, 'EXCEPTION_REQUEST', target, msg, 'D03-02');
      throw new DomainError(code, msg, problems ? { problems } : undefined);
    };
    const problems = requestProblems(body);
    if (problems.length) refuse('GUARD_FAILED', problems.map((p) => p.message).join(' · '), problems);
    const f = this.features.get(body.featureId, body.featureVersion);
    if (!f) refuse('NOT_FOUND', `${target}이(가) Registry에 없습니다.`);
    if (body.kind === 'BYPASS') {
      const p = this.policies.get(body.policyId!);
      if (!p) refuse('NOT_FOUND', `${body.policyId} 정책을 찾을 수 없습니다.`);
      if (p!.featureId !== body.featureId || p!.featureVersion !== body.featureVersion) refuse('GUARD_FAILED', `${body.policyId}은(는) ${p!.featureId} ${p!.featureVersion}의 정책입니다.`);
      if (p!.status !== 'APPROVED') refuse('GUARD_FAILED', `${body.policyId}은(는) ${p!.status} — 승인된(APPROVED) 정책의 배포에만 임시 우회를 둘 수 있습니다.`);
    } else {
      const gp = gatePendingProblems(body.gates, this.latestGates(body.featureId, body.featureVersion));
      if (gp.length) refuse('GUARD_FAILED', gp.map((p) => p.message).join(' · '), gp);
    }
    const dup = this.repo.all().find((e) => OPEN.includes(e.status) && e.kind === body.kind && e.featureId === body.featureId && e.featureVersion === body.featureVersion && e.policyId === body.policyId && exceptionDue(e, this.now()) === false && (e.kind === 'BYPASS' ? e.checks.some((c) => body.checks.includes(c)) : e.gates.some((g) => body.gates.includes(g))));
    if (dup) throw new DomainError('CONFLICT', `같은 대상의 예외 ${dup.exceptionId}(${EXCEPTION_STATUS_LABEL[dup.status]})가 이미 있습니다.`);
    const now = this.now();
    return this.db.tx(() => {
      const e: ExceptionPolicy = {
        ...body,
        exceptionId: this.repo.nextId(),
        status: 'REQUESTED',
        requestedBy: actor.id,
        requestedAt: now,
        approvals: [],
        rejection: null,
        appliedAt: null,
        expiresAt: null,
        applications: [],
        closedAt: null,
        revert: null,
      };
      this.repo.save(e);
      this.repo.log(e.exceptionId, now, 'REQUESTED', actor.id, { reason: e.reason, periodHours: e.periodHours });
      this.audit.record(actor, 'EXCEPTION_REQUEST', e.exceptionId, { after: { status: e.status, kind: e.kind, target, policyId: e.policyId, checks: e.checks, ruleIds: e.ruleIds, gates: e.gates, restriction: e.restriction, periodHours: e.periodHours }, reason: e.reason, componentId: 'D03-02' });
      this.publishRequested(actor, e);
      return this.view(e, now);
    });
  }

  private publishRequested(actor: Actor, e: ExceptionPolicy) {
    this.events.publish(
      'exception.requested',
      `${e.featureId}@${e.featureVersion}`,
      { exceptionId: e.exceptionId, kind: e.kind, kindLabel: EXCEPTION_KIND_LABEL[e.kind], featureId: e.featureId, featureVersion: e.featureVersion, policyId: e.policyId, scope: this.scopeText(e), restriction: e.restriction, restrictionLabel: EXCEPTION_RESTRICTION_LABEL[e.restriction], reason: e.reason, requestedBy: e.requestedBy, approvals: e.approvals.length, approvedBy: e.approvals.map((a) => a.by) },
      { componentId: 'D03-02', correlationId: actor.correlationId },
    );
  }

  /**
   * 승인·반려 — 승인 여부·승인자·일시·승인자 지정 만료 일시(반려는 사유). 두 번째 승인에서 적용(ACTIVE)하고 만료 일시를 정한다
   * @req FR-EXC-001-002, FR-EXC-002-002
   */
  decide(actor: Actor, id: string, body: ExceptionDecisionBody) {
    this.sweep();
    const e = this.require(id);
    const now = this.now();
    const problems = approvalProblems(e, actor.id, body, now);
    if (problems.length) {
      this.audit.failed(actor, `EXCEPTION_${body.decision}`, id, problems.map((p) => p.message).join(' · '), 'D03-02');
      throw new DomainError(problems.some((p) => p.code === 'SELF_APPROVAL' || p.code === 'SAME_APPROVER') ? 'SEPARATION_OF_DUTY' : problems[0].code === 'NOT_PENDING' ? 'CONFLICT' : 'GUARD_FAILED', problems.map((p) => p.message).join(' · '), { problems });
    }
    // Gate 예외 — 승인 시점에도 대상 Gate가 아직 PENDING이어야 한다(그사이 FAIL 판정이면 열지 않는다)
    if (body.decision === 'APPROVE' && e.kind === 'GATE_PENDING') {
      const gp = gatePendingProblems(e.gates, this.latestGates(e.featureId, e.featureVersion)).filter((p) => p.code === 'GATE_FAILED');
      if (gp.length) {
        this.audit.failed(actor, 'EXCEPTION_APPROVE', id, gp.map((p) => p.message).join(' · '), 'D03-02');
        throw new DomainError('GUARD_FAILED', gp.map((p) => p.message).join(' · '), { problems: gp });
      }
    }
    return this.db.tx(() => {
      const before = e.status;
      let next: ExceptionPolicy;
      if (body.decision === 'REJECT') next = { ...e, status: 'REJECTED', rejection: { by: actor.id, at: now, reason: body.reason }, closedAt: now };
      else {
        const approvals = [...e.approvals, { by: actor.id, role: actor.role, at: now, reason: body.reason, expiresAt: new Date(body.expiresAt!).toISOString() }];
        const done = approvals.length >= EXCEPTION_REQUIRED_APPROVALS;
        next = done
          ? { ...e, approvals, status: 'ACTIVE', appliedAt: now, expiresAt: finalExpiry(now, e.periodHours, approvals.map((a) => a.expiresAt)) }
          : { ...e, approvals, status: 'APPROVING' };
      }
      this.repo.save(next);
      this.repo.log(id, now, next.status === 'APPROVING' ? 'APPROVED_1' : next.status, actor.id, { reason: body.reason, expiresAt: body.expiresAt ?? null, finalExpiresAt: next.expiresAt });
      this.audit.record(actor, `EXCEPTION_${body.decision}`, id, { before: { status: before, approvals: e.approvals.length }, after: { status: next.status, approvals: next.approvals.length, expiresAt: next.expiresAt }, reason: body.reason, componentId: 'D03-02' });
      const meta = { componentId: 'D03-02', correlationId: actor.correlationId };
      if (next.status === 'APPROVING') this.publishRequested(actor, next);
      else if (next.status === 'ACTIVE') this.events.publish('exception.activated', `${e.featureId}@${e.featureVersion}`, { exceptionId: id, featureId: e.featureId, featureVersion: e.featureVersion, expiresAt: next.expiresAt, approvedBy: next.approvals.map((a) => a.by) }, meta);
      else this.events.publish('exception.rejected', `${e.featureId}@${e.featureVersion}`, { exceptionId: id, featureId: e.featureId, featureVersion: e.featureVersion, reason: body.reason, rejectedBy: actor.id }, meta);
      return this.view(next, now);
    });
  }

  /** 회수 — 적용 중이면 이전 정책 상태로 원복, 승인 전이면 닫기만 */
  revoke(actor: Actor, id: string, body: ExceptionRevokeBody) {
    this.sweep();
    const e = this.require(id);
    if (!OPEN.includes(e.status)) {
      this.audit.failed(actor, 'EXCEPTION_REVOKE', id, `${EXCEPTION_STATUS_LABEL[e.status]} 예외 회수 시도`, 'D03-02');
      throw new DomainError('CONFLICT', `${EXCEPTION_STATUS_LABEL[e.status]} 상태의 예외는 회수할 수 없습니다.`);
    }
    return this.db.tx(() => this.view(this.close(actor, e, 'REVOKED', body.reason), this.now()));
  }

  /**
   * 만료 확인·원복(FR-EXC-002-003·004) — 만료 일시가 지난 적용 중 예외를 닫고 이전 정책 상태로 되돌린다.
   * Gate 예외의 대상 Gate가 모두 PASS가 되면 완료로 닫는다(원복 없이 제한 범위만 푼다). 닫은 수를 돌려준다
   * @req FR-EXC-002-003, FR-EXC-002-004
   */
  sweep(): number {
    const now = this.now();
    let n = 0;
    for (const e of this.repo.all().filter((x) => x.status === 'ACTIVE')) {
      // PASS 문자열만으로 제한을 풀지 않는다. unsigned()는 현재 기록과 서명·키를 검증하고
      // decisionUsable(SIGNED/IMPORTED)만 허용한다. 손상된 근거가 있으면 만료 원복은 그대로 수행한다.
      if (e.kind === 'GATE_PENDING' && e.gates.every((g) => this.latestGates(e.featureId, e.featureVersion)[g] === 'PASS') && !Object.keys(this.decisions.unsigned(e.featureId, e.featureVersion)).length) {
        this.db.tx(() => this.complete(e));
        n++;
      } else if (exceptionDue(e, now)) {
        this.db.tx(() => this.close(SYSTEM, e, 'EXPIRED', `만료 일시 ${e.expiresAt} 경과`));
        n++;
      }
    }
    return n;
  }

  private complete(e: ExceptionPolicy) {
    const now = this.now();
    for (const a of e.applications) {
      const p = this.policies.get(a.policyId);
      if (p?.exceptionScope?.exceptionIds.includes(e.exceptionId)) this.policies.update({ ...p, exceptionScope: null });
    }
    const next: ExceptionPolicy = { ...e, status: 'COMPLETED', closedAt: now };
    this.repo.save(next);
    this.repo.log(e.exceptionId, now, 'COMPLETED', SYSTEM.id, { gates: e.gates });
    this.audit.record(SYSTEM, 'EXCEPTION_COMPLETE', e.exceptionId, { before: { status: 'ACTIVE' }, after: { status: 'COMPLETED', gates: e.gates }, reason: `PENDING Gate ${e.gates.join('·')} 모두 PASS — 제한 범위 해제`, componentId: 'D03-02' });
    this.events.publish('exception.completed', `${e.featureId}@${e.featureVersion}`, { exceptionId: e.exceptionId, featureId: e.featureId, featureVersion: e.featureVersion, gates: e.gates }, { componentId: 'D03-02', correlationId: SYSTEM.correlationId });
  }

  /** 닫기 — 적용 중이었으면 적용 기록마다 이전 정책 상태로 원복하고 원복 메시지를 남긴다(호출자 트랜잭션 안) */
  private close(actor: Actor, e: ExceptionPolicy, status: 'EXPIRED' | 'REVOKED', reason: string): ExceptionPolicy {
    const now = this.now();
    const actions = e.status === 'ACTIVE' ? [...e.applications].reverse().map((a) => this.revertOne(actor, e, a)) : [];
    const message = actions.length ? actions.join(' / ') : e.status === 'ACTIVE' ? '이 예외로 연 배포가 없어 되돌릴 정책 상태가 없습니다.' : '승인 전에 회수했습니다 — 적용된 적이 없습니다.';
    const next: ExceptionPolicy = { ...e, status, closedAt: now, revert: { at: now, message, actions } };
    this.repo.save(next);
    this.repo.log(e.exceptionId, now, status, actor.id, { reason, message });
    this.audit.record(actor, status === 'EXPIRED' ? 'EXCEPTION_EXPIRE' : 'EXCEPTION_REVOKE', e.exceptionId, { before: { status: e.status, expiresAt: e.expiresAt }, after: { status, revert: message }, reason, componentId: 'D03-02' });
    this.events.publish(
      'exception.reverted',
      `${e.featureId}@${e.featureVersion}`,
      { exceptionId: e.exceptionId, cause: status, featureId: e.featureId, featureVersion: e.featureVersion, message, expiresAt: e.expiresAt, requestedBy: e.requestedBy, approvedBy: e.approvals.map((a) => a.by) },
      { componentId: 'D03-02', correlationId: actor.correlationId },
    );
    return next;
  }

  /** 적용 기록 하나 원복 — 이 예외로 배포된 정책이 아직 배포 중이면: 이전 배포가 있었으면 그 정책·단계로 다시 게시, 없었으면 멈춘다(0%) */
  private revertOne(actor: Actor, e: ExceptionPolicy, a: ExceptionPolicy['applications'][number]): string {
    const p = this.policies.get(a.policyId);
    const now = this.now();
    if (!p || p.status !== 'DEPLOYED') return `${a.policyId}은(는) 이미 ${p?.status ?? '없음'} — 되돌릴 것이 없습니다.`;
    const prior = a.prior ? this.policies.get(a.prior.policyId) : undefined;
    if (prior && prior.status === 'RETIRED' && prior.flagKey === p.flagKey) {
      this.policies.update({ ...p, status: 'RETIRED' });
      this.audit.record(actor, 'POLICY_RETIRE', p.policyId, { before: { status: 'DEPLOYED' }, after: { status: 'RETIRED' }, reason: `예외 ${e.exceptionId} 종료 — 이전 배포 ${prior.policyId}로 원복`, componentId: 'D03-02' });
      const restored: Policy = { ...prior, status: 'DEPLOYED', stageBasisPoints: a.prior!.stageBasisPoints, stagedAt: now, deployedBy: actor.id, deployedAt: now };
      this.policies.update(restored);
      const pub = this.secureDeploy.publishPolicy(restored, actor);
      this.audit.record(actor, 'POLICY_DEPLOY', prior.policyId, { before: { status: 'RETIRED' }, after: { status: 'DEPLOYED', contentHash: prior.contentHash, stage: restored.stageBasisPoints, publicationId: pub.publicationId }, reason: `예외 ${e.exceptionId} 종료 — 적용 이전 배포로 원복`, componentId: 'D03-02' });
      this.events.publish('policy.deployed', prior.policyId, { policyId: prior.policyId, flagKey: prior.flagKey, contentHash: prior.contentHash, replaced: p.policyId, publicationId: pub.publicationId, stage: restored.stageBasisPoints, reason: `예외 ${e.exceptionId} 종료 원복` }, { componentId: 'D03-02', correlationId: actor.correlationId });
      return `${p.policyId}을(를) 거두고 이전 배포 ${prior.policyId}${a.prior!.stageBasisPoints != null ? `(${a.prior!.stageBasisPoints / 100}%)` : ''}로 되돌렸습니다.`;
    }
    // 이전 배포가 없던 Flag — 멈추기(0%)는 언제나 할 수 있다. 차량은 이 정책을 켜지 않는다
    const stopped: Policy = { ...p, stageBasisPoints: 0, stagedAt: now };
    this.policies.update(stopped);
    this.audit.record(actor, 'ROLLOUT_STAGE', p.policyId, { before: { stage: p.stageBasisPoints }, after: { stage: 0, kind: 'SHRINK' }, reason: `예외 ${e.exceptionId} 종료 — 적용 이전에 배포가 없던 Flag라 멈춤`, componentId: 'D03-02' });
    this.events.publish('rollout.staged', p.policyId, { flagKey: p.flagKey, from: p.stageBasisPoints, to: 0, kind: 'SHRINK', criteria: null }, { componentId: 'D03-02', correlationId: actor.correlationId });
    return `적용 이전에 ${p.flagKey} 배포가 없어 ${p.policyId}을(를) 멈췄습니다(0%).`;
  }

  /** 출시 전 배포 판정(FR-RDD-001-006) — 정책의 Feature Version 기준. 화면이 배포 전에 같은 판정을 본다 */
  releaseGate(policyId: string): ReleaseGateDecision {
    const p = this.policies.get(policyId);
    if (!p) throw new DomainError('NOT_FOUND', `${policyId}을(를) 찾을 수 없습니다.`);
    return this.releaseFor(p);
  }

  private releaseFor(p: Pick<Policy, 'featureId' | 'featureVersion' | 'oddRestriction'>): ReleaseGateDecision & { unsignedGates?: Partial<Record<GateId, string>> } {
    const f = this.features.get(p.featureId, p.featureVersion);
    const unsignedGates = this.decisions.unsigned(p.featureId, p.featureVersion);
    const untrusted = Object.keys(unsignedGates) as GateId[];
    if (untrusted.length) {
      // 단순 PENDING으로 바꾸면 승인된 예외가 다시 덮을 수 있다. 서명·무결성은 예외로 우회할 수 없다.
      return { allowed: false, shadowOnly: true, cap: 0, restriction: null, exceptionIds: [], pendingGates: untrusted, unsignedGates, message: `${untrusted.join('·')} 판정의 서명된 근거를 확인할 수 없습니다 — 올바른 근거로 다시 판정한 뒤 배포하세요.` };
    }
    return releaseGateDecision({ featureId: p.featureId, featureVersion: p.featureVersion, lifecycle: f?.lifecycle ?? '미등록', latestGates: this.latestGates(p.featureId, p.featureVersion), exceptions: this.repo.all(), now: this.now(), narrowing: !!p.oddRestriction });
  }

  /**
   * 배포 검사 예외 층 — 출시 전 Version은 Shadow만(예외 없으면 거부), 그 밖 검사는 적용 중 임시 우회만 연다.
   * @req FR-RDD-001-006, FR-REG-005-010, FR-EXC-002-001
   * @rule FFG-LCY-002 — 예외 층은 Gate 판정을 바꾸지 않는다(Gate 기록·결정 기록 그대로, PENDING Gate는 PENDING). 기록된 제한 범위만 연다
   */
  forDeploy(actor: Actor, p: Policy): DeployExceptionGate {
    this.sweep();
    const now = this.now();
    const release = this.releaseFor(p);
    const list = this.repo.all();
    const used = new Map<string, ExceptionPolicy>();
    for (const id of release.exceptionIds) used.set(id, this.repo.get(id)!);
    return {
      release,
      assertRelease: () => {
        if (release.allowed) return;
        this.audit.failed(actor, 'POLICY_DEPLOY', p.policyId, release.message, 'D03-02');
        const unsigned = Object.entries(release.unsignedGates ?? {});
        const blockers = unsigned.length ? unsigned.map(([ref, message]) => ({ code: 'GATE_UNSIGNED', message, ref })) : [{ code: 'PRE_RELEASE_SHADOW_ONLY', message: release.message, ref: release.pendingGates.join(',') }];
        throw new DomainError('GUARD_FAILED', release.message, { rule: unsigned.length ? 'FFG-LCY-001' : 'FR-RDD-001-006', blockers, release });
      },
      waive: (check, err) => {
        const ruleIds = check === 'COMPLIANCE_RULE' ? (((err as DomainError | undefined)?.details as { findings?: { ruleId?: string }[] } | undefined)?.findings ?? []).map((x) => x.ruleId).filter((x): x is string => !!x) : undefined;
        const w = exceptionWaiver(list, { featureId: p.featureId, featureVersion: p.featureVersion, policyId: p.policyId, check, ruleIds }, now);
        if (w) used.set(w.exceptionId, w);
        return !!w;
      },
      cap: () => (used.size ? Math.min(...[...used.values()].map((e) => RESTRICTION_CAP_BP[e.restriction])) : null),
      used: () => [...used.keys()].sort(),
      applied: (by, next, prev) => {
        if (!used.size) return next;
        const es = [...used.values()];
        const narrow = es.reduce((a, e) => (RESTRICTION_CAP_BP[e.restriction] < RESTRICTION_CAP_BP[a.restriction] ? e : a));
        const cap = RESTRICTION_CAP_BP[narrow.restriction];
        const scoped: Policy = { ...next, exceptionScope: { exceptionIds: es.map((e) => e.exceptionId).sort(), restriction: narrow.restriction as 'LIMITED' | 'PILOT', capBasisPoints: cap } };
        this.policies.update(scoped);
        for (const e of es) {
          const cur = this.repo.get(e.exceptionId)!;
          const app = { policyId: next.policyId, flagKey: next.flagKey, at: now, by: by.id, prior: prev && prev.policyId !== next.policyId ? { policyId: prev.policyId, stageBasisPoints: prev.stageBasisPoints ?? null } : null, capBasisPoints: cap };
          this.repo.save({ ...cur, applications: [...cur.applications, app] });
          this.repo.log(e.exceptionId, now, 'APPLIED', by.id, { policyId: next.policyId, prior: app.prior, capBasisPoints: cap });
          this.audit.record(by, 'EXCEPTION_APPLY', e.exceptionId, { after: { policyId: next.policyId, stage: next.stageBasisPoints, capBasisPoints: cap, prior: app.prior }, reason: `${this.scopeText(e)} — ${EXCEPTION_RESTRICTION_LABEL[e.restriction]} 범위로 배포`, componentId: 'D03-02' });
        }
        return scoped;
      },
    };
  }
}

@Controller('api/exceptions')
export class ExceptionPolicyController {
  constructor(private readonly svc: ExceptionPolicyService) {}

  @Get()
  list(@Query() q: Record<string, string>) {
    return this.svc.list(q);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Post()
  @Roles(...EXCEPTION_REQUEST_ROLES)
  @AuditAction('EXCEPTION_REQUEST')
  create(@CurrentActor() actor: Actor, @Body(new ZodPipe(CreateExceptionBody)) body: CreateExceptionBody) {
    return this.svc.create(actor, body);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @Roles(...EXCEPTION_APPROVER_ROLES)
  @AuditAction('EXCEPTION_DECIDE')
  decide(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ExceptionDecisionBody)) body: ExceptionDecisionBody) {
    return this.svc.decide(actor, id, body);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @Roles(...EXCEPTION_REQUEST_ROLES, ...EXCEPTION_APPROVER_ROLES)
  @AuditAction('EXCEPTION_REVOKE')
  revoke(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ExceptionRevokeBody)) body: ExceptionRevokeBody) {
    return this.svc.revoke(actor, id, body);
  }
}

@Controller('api/policies')
export class PolicyReleaseGateController {
  constructor(private readonly svc: ExceptionPolicyService) {}

  @Get(':id/release-gate')
  releaseGate(@Param('id') id: string) {
    return this.svc.releaseGate(id);
  }
}
