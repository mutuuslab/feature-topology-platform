// 운영 데이터 수집 (D04-03) — IF-06 차량 회신(readback)·GLEO status_report를 받아 저장하고 이벤트로 알린다.
// 집계(CONFIRMED/PARTIAL/…)는 보안 배포(D06-08)가 ReadbackBus를 구독해 다시 계산한다(모듈 간 순환 의존 없음).
import { Body, Controller, Get, HttpCode, Inject, Injectable, Post, Query } from '@nestjs/common';
import { ReadbackBody } from '@ff/contracts';
import { Subject } from 'rxjs';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';

import { PublicationRepo, type StoredReadback } from '../../d06-qsec/secure-deploy/publication.repo';

/** 회신이 저장된 게시본 ID를 알린다 (커밋 후) */
@Injectable()
export class ReadbackBus extends Subject<string> {}

@Injectable()
@PlatformComponent('D04-03')
export class TelemetryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly repo: PublicationRepo,
    private readonly events: EventService,
    private readonly bus: ReadbackBus,
  ) {}

  ingest(body: ReadbackBody, via: StoredReadback['via'] = 'IF-06', correlationId?: string): StoredReadback {
    const pub = this.repo.get(body.publicationId);
    if (!pub) throw new DomainError('NOT_FOUND', `게시본 ${body.publicationId}을(를) 찾을 수 없습니다.`);
    if (!pub.payload.targets.includes(body.vin)) throw new DomainError('VALIDATION', `${body.vin}은(는) ${body.publicationId}의 대상 차량이 아닙니다.`);
    const r: StoredReadback = { ...body, at: this.clock.iso(), via };
    return this.db.tx(() => {
      this.repo.addReadback(r);
      this.events.publish('vehicle.readback', body.vin, { publicationId: body.publicationId, kind: pub.kind, observed: body.observed, metricType: body.metricType, rejectReason: body.rejectReason ?? null, via }, { componentId: 'D04-03', correlationId });
      this.db.afterCommit(() => this.bus.next(body.publicationId));
      return r;
    });
  }

  list(q: { publicationId?: string; vin?: string }) {
    return this.repo.readbacks(q);
  }
}

@Controller('api/telemetry')
export class TelemetryController {
  constructor(private readonly telemetry: TelemetryService) {}

  /** IF-06 — 외부 Fleet 수집기가 차량 회신을 넣는 입구 (시스템 계정) */
  @Post('readback')
  @HttpCode(202)
  @Roles('SYSTEM')
  @AuditAction('TELEMETRY_READBACK')
  readback(@CurrentActor() actor: Actor, @Body(new ZodPipe(ReadbackBody)) body: ReadbackBody) {
    return this.telemetry.ingest(body, 'IF-06', actor.correlationId);
  }

  @Get('readbacks')
  readbacks(@Query('publicationId') publicationId?: string, @Query('vin') vin?: string) {
    return { items: this.telemetry.list({ publicationId, vin }) };
  }
}
