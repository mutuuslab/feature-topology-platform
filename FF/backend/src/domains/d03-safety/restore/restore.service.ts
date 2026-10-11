// 이전 상태 복구 (D03-04) — 긴급 차단 해제. 서버 판단은 해제 즉시 차단 전 정책으로 돌아가고,
// 차량에는 서명된 복구 게시본(RESTORE, 같은 Feature 순번 공간 → 오래된 차단 명령의 재전송을 막는다)을 긴급 채널로 보낸다.
import { Body, Controller, HttpCode, Inject, Injectable, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { SecureDeployService } from '../../d06-qsec/secure-deploy/secure-deploy.service';
import { KILL_ROLES, KillService } from '../kill-switch/kill.service';
import { KillRepo } from '../kill-switch/kill.repo';

const ReasonBody = z.object({ reason: z.string().trim().min(2).max(500) }).strict();

@Injectable()
@PlatformComponent('D03-04')
export class RestoreService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly kills: KillRepo,
    private readonly killService: KillService,
    private readonly deploy: SecureDeployService,
    private readonly audit: AuditService,
    private readonly events: EventService,
  ) {}

  release(actor: Actor, killId: string, reason: string) {
    const k = this.kills.get(killId);
    if (!k) throw new DomainError('NOT_FOUND', `차단 요청 ${killId}을(를) 찾을 수 없습니다.`);
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
}

@Controller('api/kill-requests')
export class RestoreController {
  constructor(private readonly restore: RestoreService) {}

  @Post(':id/release')
  @HttpCode(200)
  @Roles(...KILL_ROLES)
  @AuditAction('KILL_RELEASE')
  release(@CurrentActor() actor: Actor, @Param('id') id: string, @Body(new ZodPipe(ReasonBody)) body: { reason: string }) {
    return this.restore.release(actor, id, body.reason);
  }
}
