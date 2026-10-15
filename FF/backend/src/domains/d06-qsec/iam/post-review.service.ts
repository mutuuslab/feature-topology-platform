// IAM 직무 분리 감사·긴급 권한 사후 검토 (D06-09, 보고서 v1.1 · FFG-PLT-016) — 데모 계정의 겸직(요구 승인·출시·Kill 실행·복원 승인) 감사와,
// 발행된 Kill(긴급 권한 사용)마다 24시간 안의 사후 독립 검토 기록(035, 추가만 — 한 명령에 한 번). 검토자는 그 명령의 요청자·승인자가 아니어야 한다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post } from '@nestjs/common';
import { DEMO_PERSONAS, DUTY_ROLES, dutyConflicts, POST_REVIEW_MS, PostReviewBody, postReviewBlocker, type KillRequest } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';

@Injectable()
@PlatformComponent('D06-09')
export class PostReviewService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  private issued(): KillRequest[] {
    return this.db
      .all<{ doc: string }>('SELECT doc FROM kill_request ORDER BY kill_id')
      .map((r) => JSON.parse(r.doc) as KillRequest)
      .filter((k) => !!k.command);
  }

  /** 발행된 Kill마다 사후 검토 기한·기록·상태(REVIEWED·PENDING·OVERDUE) */
  list() {
    const now = this.clock.iso();
    const reviews = new Map(this.db.all<{ kill_id: string; reviewer: string; role: string; at: string; summary: string }>('SELECT kill_id, reviewer, role, at, summary FROM kill_post_review').map((r) => [r.kill_id, r]));
    return this.issued().map((k) => {
      const due = new Date(Date.parse(k.command!.issuedAt) + POST_REVIEW_MS).toISOString();
      const r = reviews.get(k.killId);
      return {
        killId: k.killId,
        featureId: k.featureId,
        issuedAt: k.command!.issuedAt,
        due,
        requestedBy: k.requestedBy,
        approvers: (k.approvals ?? []).map((a) => a.approverId),
        review: r ? { reviewer: r.reviewer, role: r.role, at: r.at, summary: r.summary, late: r.at > due } : null,
        status: r ? 'REVIEWED' : now > due ? 'OVERDUE' : 'PENDING',
      };
    });
  }

  /**
   * 사후 독립 검토 기록 — 요청자·승인자는 검토할 수 없고, 한 명령에 한 번.
   * @rule FFG-PLT-016 — 긴급 권한 사용(Kill 발행) 100%에 사후 독립 검토 기록
   */
  review(actor: Actor, killId: string, body: PostReviewBody) {
    const k = this.issued().find((x) => x.killId === killId);
    if (!k) throw new DomainError('NOT_FOUND', `${killId}은(는) 발행된 차단 명령이 아닙니다.`);
    const blocker = postReviewBlocker({ requestedBy: k.requestedBy, approvers: (k.approvals ?? []).map((a) => a.approverId) }, actor.id);
    if (blocker) {
      this.audit.failed(actor, 'KILL_POST_REVIEW', killId, `FFG-PLT-016 ${blocker}`, 'D06-09');
      throw new DomainError('SEPARATION_OF_DUTY', blocker, { rule: 'FFG-PLT-016' });
    }
    if (this.db.get('SELECT 1 FROM kill_post_review WHERE kill_id = ?', killId)) throw new DomainError('CONFLICT', `${killId}은(는) 이미 사후 검토되었습니다.`);
    const at = this.clock.iso();
    this.db.tx(() => {
      this.db.run('INSERT INTO kill_post_review (kill_id, reviewer, role, at, summary) VALUES (?, ?, ?, ?, ?)', killId, actor.id, actor.role, at, body.summary);
      this.audit.record(actor, 'KILL_POST_REVIEW', killId, { after: { summary: body.summary }, componentId: 'D06-09' });
      this.events.publish('kill.post_reviewed', killId, { killId, reviewer: actor.id, role: actor.role }, { componentId: 'D06-09', correlationId: actor.correlationId });
    });
    return this.list().find((x) => x.killId === killId)!;
  }

  /** 직무 분리 감사 — 겸직 계정과 긴급 권한 사후 검토 현황 */
  sodAudit() {
    const reviews = this.list();
    return {
      duties: DUTY_ROLES,
      accounts: DEMO_PERSONAS,
      conflicts: dutyConflicts(DEMO_PERSONAS),
      postReviews: { issued: reviews.length, reviewed: reviews.filter((r) => r.status === 'REVIEWED').length, pending: reviews.filter((r) => r.status === 'PENDING').length, overdue: reviews.filter((r) => r.status === 'OVERDUE').length },
    };
  }
}

@Controller('api')
export class PostReviewController {
  constructor(private readonly svc: PostReviewService) {}

  @Get('iam/sod-audit')
  sodAudit() {
    return this.svc.sodAudit();
  }

  @Get('kill-post-reviews')
  list() {
    return { items: this.svc.list() };
  }

  @Post('kill-requests/:id/post-review')
  @HttpCode(201)
  @Roles('SAFETY_OFFICER', 'SECURITY_OFFICER', 'REGULATORY_OWNER')
  @AuditAction('KILL_POST_REVIEW')
  review(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(PostReviewBody)) body: PostReviewBody) {
    return this.svc.review(actor, id, body);
  }
}
