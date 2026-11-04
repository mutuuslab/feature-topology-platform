// 이전 상태 복구 (D03-04) — 보고서 v1.1 7.6: 복원은 다른 승인자, 다음 시동, 자체 시험(FFG-DEAC-008).
// v2 차단: 복원 요청(재검증 Evidence·이번 단계 Cohort) → 2인 승인(직전 차단 승인자 제외, F2 이상 안전·보안은 FSM) → 정책 게이트(Canary 상한·BOM·SBOM, 폐기 Feature 거부)
// → 원장 +1 → kill_command v2(request=restore, 복원 용도 키) → 차량별 봉투 → 서명된 복구 게시본(RESTORE, 같은 Feature 순번 공간 — 오래된 차단 재전송 방지).
// v1 레거시 차단(safeMode 있음)은 기존 단일 해제를 유지한다.
import { Body, Controller, HttpCode, Inject, Injectable, Param, Post } from '@nestjs/common';
import { approvalPlan, KillApproveBody, KillRejectBody, RestoreRequestBody, type KillRequest, type RestoreRequest } from '@ff/contracts';
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

  /** 아직 복원하지 않은 차단 차량 */
  private remaining(k: KillRequest): string[] {
    const done = new Set(k.restoredVins ?? []);
    return k.vins.filter((v) => !done.has(v));
  }

  /**
   * 복원 요청 — 차단이 ACTIVE이고 진행 중인 복원 요청이 없어야 한다.
   * 재검증 Evidence(이 Feature의 판정 근거)와 이번 단계 Cohort(아직 복원하지 않은 차단 차량)가 있어야 한다(FPW.8-A08 종료 기준).
   * Cohort를 넓혀 가며 다시 요청하면 단계적 복원(A10) — 단계마다 다른 2인 승인·게이트(Canary 상한)를 거친다.
   */
  request(actor: Actor, killId: string, body: RestoreRequestBody) {
    const k = this.load(killId);
    const open = k.restoreRequest?.status === 'REQUESTED';
    if (k.version !== 2 || k.status !== 'ACTIVE' || open) {
      this.audit.failed(actor, 'RESTORE_REQUEST', killId, `복원 요청 불가(${k.version === 2 ? k.status : 'v1 레거시'}${open ? ', 진행 중 요청 있음' : ''})`, 'D03-04');
      throw new DomainError('CONFLICT', k.version !== 2 ? 'v1 레거시 차단은 해제(release)로 처리합니다.' : open ? '이미 복원 승인 대기 중입니다.' : `차단 중인 요청이 아닙니다 (${k.status}).`);
    }
    const left = new Set(this.remaining(k));
    const cohort = [...new Set(body.cohort)];
    const excluded = [...new Set([...(k.approvals ?? []).map((a) => a.approverId), ...(this.gate.ledger(k.featureId).last_kill_approvers ?? [])])];
    const outside = cohort.filter((v) => !left.has(v));
    if (outside.length) {
      this.audit.failed(actor, 'RESTORE_REQUEST', killId, `Cohort에 복원 대상이 아닌 차량: ${outside.join(', ')}`, 'D03-04');
      throw new DomainError('VALIDATION', `이번 단계 Cohort에 이 차단의 남은 차량이 아닌 차량이 있습니다: ${outside.join(', ')}`, { outside });
    }
    const evidenceRef = body.evidenceRef.trim();
    const matchingEvidence = this.db.all<{ doc: string }>('SELECT doc FROM evidence WHERE evidence_ref = ?', evidenceRef);
    // 외부 보고서 하나를 여러 Feature·Gate가 공유할 수 있다. 대상 Feature의 PASS 행을 찾는다(화면 필터를 API에서도 강제).
    const passed = matchingEvidence.some((row) => {
      const e = JSON.parse(row.doc) as { featureId?: string; inputResult?: string };
      return k.featureIds.includes(e.featureId ?? '') && e.inputResult === 'PASS';
    });
    if (!passed) {
      this.audit.failed(actor, 'RESTORE_REQUEST', killId, `재검증 Evidence ${evidenceRef} 없음 또는 대상 Feature의 PASS 판정 아님`, 'D03-04');
      throw new DomainError('VALIDATION', `재검증 Evidence ${evidenceRef}을(를) ${k.featureId}의 PASS 판정 근거에서 찾을 수 없습니다 — 원인 수정 뒤 PASS로 판정한 Evidence를 고르세요.`, { field: 'evidenceRef' });
    }
    const rr: RestoreRequest = {
      requestedBy: actor.id,
      requestedAt: this.clock.iso(),
      reason: body.reason,
      status: 'REQUESTED',
      approvals: [],
      gate: null,
      command: null,
      rejectedBy: null,
      rejectReason: null,
      evidenceRef,
      cohort: k.vins.filter((v) => cohort.includes(v)),
    };
    return this.db.tx(() => {
      const next = { ...k, restoreRequest: rr };
      this.kills.update(next);
      this.audit.record(actor, 'RESTORE_REQUEST', killId, { after: { status: 'REQUESTED', evidenceRef, cohort: rr.cohort!.length, remaining: left.size }, reason: body.reason, componentId: 'D03-04' });
      // 알림은 실제로 승인할 수 있는 사람에게 — 직전 차단 승인자를 뺀 승인 후보(P4-1). 끝낼 수 없으면 상위 대응 경보
      const outlook = this.killService.warnRestoreBlocked(actor, next);
      this.events.publish(
        'kill.restore-requested',
        killId,
        { killId, featureId: k.featureId, cohort: rr.cohort!.length, evidenceRef, candidates: outlook.candidates.map((c) => c.id), complete: outlook.complete, excluded },
        { componentId: 'D03-04', correlationId: actor.correlationId },
      );
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
    // 이번 단계 Cohort(이전 행은 남은 차량 전체) — 서명 대상·명령 범위·복구 게시본이 모두 이 차량들
    const cohort = rr.cohort?.length ? rr.cohort : this.remaining(k);
    const stage: KillRequest = { ...k, vins: cohort };
    const a = this.killService.signApproval(
      actor,
      { ...stage, reasonCategory: k.reasonCategory! },
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
    const draft = this.killService.buildCommand(stage, 'restore', approvals);
    try {
      return this.db.tx(() => {
        const issued = this.killService.issueCommand(actor, stage, draft);
        const pub = this.deploy.publishRestore(stage, actor, this.killService.applyWithin(k, 'restore'));
        const at = this.clock.iso();
        const restoredVins = [...(k.restoredVins ?? []), ...cohort];
        // 모든 차단 차량이 복원되면 해제(RELEASED), 아니면 차단 유지 — 다음 Cohort로 넓힌다(FPW.8-A10)
        const all = k.vins.every((v) => restoredVins.includes(v));
        const done: KillRequest = {
          ...k,
          ...(all ? { status: 'RELEASED' as const, releasedBy: actor.id, releasedAt: at, releaseReason: rr.reason } : {}),
          restoredVins,
          restoreStages: [...(k.restoreStages ?? []), { cohort, evidenceRef: rr.evidenceRef ?? null, publicationId: pub.publicationId, approvedAt: at, approvers: approvals.map((x) => x.approverId) }],
          restorePublicationId: pub.publicationId,
          restoreRequest: { ...rr, cohort, approvals, status: 'APPROVED', gate: { result: 'PASS', failed: [], at }, command: this.killService.commandRef(issued) },
        };
        this.kills.update(done);
        this.audit.record(actor, 'RESTORE_APPROVE', killId, { after: { approvals: 2, role: a.role, kid: a.kid, cohort: cohort.length }, componentId: 'D03-04' });
        if (all)
          this.audit.record(actor, 'KILL_RELEASE', killId, {
            before: { status: 'ACTIVE' },
            after: { status: 'RELEASED', commandId: issued.command.command_id, commandSeq: issued.command.command_seq, envelopes: issued.envelopes, publicationId: pub.publicationId },
            reason: rr.reason,
            componentId: 'D03-04',
          });
        // 부분 복원은 kill.restore-staged — 알림·관제 이벤트는 단계로 보인다. 다 끝나면 kill.released
        this.events.publish(
          all ? 'kill.released' : 'kill.restore-staged',
          killId,
          { killId, featureId: k.featureId, publicationId: pub.publicationId, commandId: issued.command.command_id, restored: restoredVins.length, total: k.vins.length },
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
  request(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(RestoreRequestBody)) body: RestoreRequestBody) {
    return this.restore.request(actor, id, body);
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
