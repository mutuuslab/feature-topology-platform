// 이전 상태 복구 (D03-04) — 보고서 v1.1 7.6: 복원은 다른 승인자, 다음 시동, 자체 시험(FFG-DEAC-008).
// v2 차단: 복원 요청 → 2인 승인(직전 차단 승인자 제외, F2 이상 안전·보안은 FSM) → 정책 게이트(Canary 상한·BOM·SBOM, 폐기 Feature 거부)
// → 원장 +1 → kill_command v2(request=restore, 복원 용도 키) → 차량별 봉투 → 서명된 복구 게시본(RESTORE, 같은 Feature 순번 공간 — 오래된 차단 재전송 방지).
// v1 레거시 차단(safeMode 있음)은 기존 단일 해제를 유지한다.
import { Body, Controller, HttpCode, Inject, Injectable, Param, Post } from '@nestjs/common';
import { approvalPlan, KillApproveBody, KillRejectBody, type KillRequest, type RestoreRequest } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { SecureDeployService } from '../../d06-qsec/secure-deploy/secure-deploy.service';
import { GateRejected, PolicyGateService } from '../deploy-safety/policy-gate.service';
import { KILL_ROLES, KillService } from '../kill-switch/kill.service';
import { KillRepo } from '../kill-switch/kill.repo';

const APPROVER_ROLES = ['SAFETY_OFFICER', 'SECURITY_OFFICER', 'OPS_LEAD', 'PRODUCT_APPROVER', 'GATE_JUDGE', 'REGULATORY_OWNER'] as const;

@Injectable()
@PlatformComponent('D03-04')
export class RestoreService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly kills: KillRepo,
    private readonly killService: KillService,
    private readonly deploy: SecureDeployService,
    private readonly gate: PolicyGateService,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  private load(killId: string): KillRequest {
    const k = this.kills.get(killId);
    if (!k) throw new DomainError('NOT_FOUND', `차단 요청 ${killId}을(를) 찾을 수 없습니다.`);
    return k;
  }

  /** v1 레거시 차단 해제(단일 승인) — v2 차단은 복원 요청·2인 승인으로 */
  release(actor: Actor, killId: string, reason: string) {
    const k = this.load(killId);
    if (k.version === 2) {
      this.audit.failed(actor, 'KILL_RELEASE', killId, 'v2 차단 단독 해제 시도 — 복원 요청·2인 승인 필요', 'D03-04');
      throw new DomainError('CONFLICT', 'v2 차단은 혼자 해제할 수 없습니다 — 복원 요청 후 다른 2인이 승인합니다 (FFG-DEAC-008).');
    }
    if (k.status !== 'ACTIVE') {
      this.audit.failed(actor, 'KILL_RELEASE', killId, `${k.status} 차단 해제 시도`, 'D03-04');
      throw new DomainError('GUARD_FAILED', `이미 해제된 차단입니다 (${k.releasedAt}).`);
    }
    this.db.tx(() => {
      const pub = this.deploy.publishRestore(k, actor);
      const next = { ...k, status: 'RELEASED' as const, releasedBy: actor.id, releasedAt: this.clock.iso(), releaseReason: reason, restorePublicationId: pub.publicationId };
      this.kills.update(next);
      this.audit.record(actor, 'KILL_RELEASE', killId, { before: { status: 'ACTIVE' }, after: { status: 'RELEASED', publicationId: pub.publicationId }, reason, componentId: 'D03-04' });
      this.events.publish('kill.released', killId, { killId, featureId: k.featureId, publicationId: pub.publicationId }, { componentId: 'D03-04', correlationId: actor.correlationId });
    });
    return this.killService.detail(killId);
  }

  /** 복원 요청 — 차단이 ACTIVE이고 진행 중인 복원 요청이 없어야 한다 */
  request(actor: Actor, killId: string, reason: string) {
    const k = this.load(killId);
    const open = k.restoreRequest?.status === 'REQUESTED';
    if (k.version !== 2 || k.status !== 'ACTIVE' || open) {
      this.audit.failed(actor, 'RESTORE_REQUEST', killId, `복원 요청 불가(${k.version === 2 ? k.status : 'v1 레거시'}${open ? ', 진행 중 요청 있음' : ''})`, 'D03-04');
      throw new DomainError('CONFLICT', k.version !== 2 ? 'v1 레거시 차단은 해제(release)로 처리합니다.' : open ? '이미 복원 승인 대기 중입니다.' : `차단 중인 요청이 아닙니다 (${k.status}).`);
    }
    const rr: RestoreRequest = { requestedBy: actor.id, requestedAt: this.clock.iso(), reason, status: 'REQUESTED', approvals: [], gate: null, command: null, rejectedBy: null, rejectReason: null };
    return this.db.tx(() => {
      this.kills.update({ ...k, restoreRequest: rr });
      this.audit.record(actor, 'RESTORE_REQUEST', killId, { after: { status: 'REQUESTED' }, reason, componentId: 'D03-04' });
      this.events.publish('kill.restore-requested', killId, { killId, featureId: k.featureId }, { componentId: 'D03-04', correlationId: actor.correlationId });
      return this.killService.detail(killId);
    });
  }

  /**
   * 복원 승인 — 두 번째 승인이면 게이트(복원 승인자 ≠ 직전 차단 승인자, Canary, BOM·SBOM, 폐기 거부) 후 복구 게시.
   * @rule FFG-DEAC-008, FFG-ADS-010 — 다른 승인자·폐기 Feature 복원 금지(다음 시동·자체 시험은 차량 SW)
   */
  approve(actor: Actor, killId: string, body: KillApproveBody) {
    const k = this.load(killId);
    const rr = k.restoreRequest;
    if (k.status !== 'ACTIVE' || rr?.status !== 'REQUESTED') {
      this.audit.failed(actor, 'RESTORE_APPROVE', killId, '복원 승인 대기 아님', 'D03-04');
      throw new DomainError('CONFLICT', '복원 승인 대기 중인 요청이 아닙니다.');
    }
    const plan = approvalPlan(k.fClass!, 'restore', k.reasonCategory!);
    // 직전 차단 승인자 — 이 차단의 승인자와 원장의 마지막 Kill 승인자
    const excluded = [...new Set([...(k.approvals ?? []).map((a) => a.approverId), ...(this.gate.ledger(k.featureId).last_kill_approvers ?? [])])];
    const a = this.killService.signApproval(
      actor,
      { ...k, reasonCategory: k.reasonCategory! },
      'restore',
      { requestedBy: rr.requestedBy, approvals: rr.approvals, plan, excluded },
      'RESTORE_APPROVE',
      body.comment,
    );
    const approvals = [...rr.approvals, a];
    if (approvals.length < plan.count) {
      return this.db.tx(() => {
        this.kills.update({ ...k, restoreRequest: { ...rr, approvals } });
        this.audit.record(actor, 'RESTORE_APPROVE', killId, { after: { approvals: approvals.length, role: a.role, kid: a.kid }, componentId: 'D03-04' });
        this.events.publish('kill.restore-approved', killId, { killId, approvals: approvals.length, role: a.role }, { componentId: 'D03-04', correlationId: actor.correlationId });
        return this.killService.detail(killId);
      });
    }
    const draft = this.killService.buildCommand(k, 'restore', approvals);
    try {
      return this.db.tx(() => {
        const issued = this.killService.issueCommand(actor, k, draft);
        const pub = this.deploy.publishRestore(k, actor);
        const done: KillRequest = {
          ...k,
          status: 'RELEASED',
          releasedBy: actor.id,
          releasedAt: this.clock.iso(),
          releaseReason: rr.reason,
          restorePublicationId: pub.publicationId,
          restoreRequest: { ...rr, approvals, status: 'APPROVED', gate: { result: 'PASS', failed: [], at: this.clock.iso() }, command: this.killService.commandRef(issued) },
        };
        this.kills.update(done);
        this.audit.record(actor, 'RESTORE_APPROVE', killId, { after: { approvals: 2, role: a.role, kid: a.kid }, componentId: 'D03-04' });
        this.audit.record(actor, 'KILL_RELEASE', killId, {
          before: { status: 'ACTIVE' },
          after: { status: 'RELEASED', commandId: issued.command.command_id, commandSeq: issued.command.command_seq, envelopes: issued.envelopes, publicationId: pub.publicationId },
          reason: rr.reason,
          componentId: 'D03-04',
        });
        this.events.publish(
          'kill.released',
          killId,
          { killId, featureId: k.featureId, publicationId: pub.publicationId, commandId: issued.command.command_id },
          { componentId: 'D03-04', correlationId: actor.correlationId },
        );
        return this.killService.detail(killId);
      });
    } catch (e) {
      if (!(e instanceof GateRejected)) throw e;
      const failed = e.verdict.findings.filter((x) => !x.ok);
      this.audit.failed(actor, 'RESTORE_APPROVE', killId, `정책 게이트 거부: ${failed.map((x) => x.rule).join(', ')}`, 'D03-02');
      return this.db.tx(() => {
        const rejected = {
          ...rr,
          approvals,
          status: 'REJECTED' as const,
          gate: { result: e.verdict.result, failed: failed.map((x) => x.rule), at: this.clock.iso() },
          rejectedBy: 'policy-gate',
          rejectReason: failed.map((x) => `${x.rule} ${x.message}`).join(' / '),
        };
        this.kills.update({ ...k, restoreRequest: rejected });
        this.events.publish('kill.restore-rejected', killId, { killId, by: 'policy-gate', failed: rejected.gate.failed }, { componentId: 'D03-04', correlationId: actor.correlationId });
        return this.killService.detail(killId);
      });
    }
  }

  reject(actor: Actor, killId: string, reason: string) {
    const k = this.load(killId);
    const rr = k.restoreRequest;
    if (rr?.status !== 'REQUESTED') {
      this.audit.failed(actor, 'RESTORE_REJECT', killId, '복원 승인 대기 아님', 'D03-04');
      throw new DomainError('CONFLICT', '복원 승인 대기 중인 요청이 아닙니다.');
    }
    return this.db.tx(() => {
      this.kills.update({ ...k, restoreRequest: { ...rr, status: 'REJECTED', rejectedBy: actor.id, rejectReason: reason } });
      this.audit.record(actor, 'RESTORE_REJECT', killId, { before: { status: 'REQUESTED' }, after: { status: 'REJECTED' }, reason, componentId: 'D03-04' });
      this.events.publish('kill.restore-rejected', killId, { killId, by: actor.id }, { componentId: 'D03-04', correlationId: actor.correlationId });
      return this.killService.detail(killId);
    });
  }
}

@Controller('api/kill-requests')
export class RestoreController {
  constructor(private readonly restore: RestoreService) {}

  @Post(':id/release')
  @HttpCode(200)
  @Roles(...KILL_ROLES)
  @AuditAction('KILL_RELEASE')
  release(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(KillRejectBody)) body: KillRejectBody) {
    return this.restore.release(actor, id, body.reason);
  }

  @Post(':id/restore')
  @Roles(...KILL_ROLES)
  @AuditAction('RESTORE_REQUEST')
  request(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(KillRejectBody)) body: KillRejectBody) {
    return this.restore.request(actor, id, body.reason);
  }

  @Post(':id/restore/approvals')
  @Roles(...APPROVER_ROLES)
  @AuditAction('RESTORE_APPROVE')
  approve(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(KillApproveBody)) body: KillApproveBody) {
    return this.restore.approve(actor, id, body);
  }

  @Post(':id/restore/reject')
  @Roles(...APPROVER_ROLES)
  @AuditAction('RESTORE_REJECT')
  reject(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(KillRejectBody)) body: KillRejectBody) {
    return this.restore.reject(actor, id, body.reason);
  }
}
