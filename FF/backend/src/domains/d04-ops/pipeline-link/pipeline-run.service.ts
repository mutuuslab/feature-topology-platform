// CI/CD 파이프라인 실행 결과 수신 (D04-01 배포 파이프라인 연계, IF-13) — CI가 실행 ID·환경·상태·실패 단계·사유를 보낸다.
// 실행 ID별 마지막 상태를 남기고, 실패면 오류 이력(B6)에 한 건 — 같은 기록에서 담당자 알림(FR-CICD-001-006)이 나간다.
import { Body, Controller, Get, HttpCode, Inject, Injectable, Post, Query } from '@nestjs/common';
import { PipelineRunBody, PIPELINE_RUN_STATUSES, type PipelineRun } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { singleQuery } from '../../../kernel/paging';
import { ZodPipe } from '../../../kernel/zod.pipe';
import { IntegrationErrorService } from '../event-history/integration-error.service';

@Injectable()
@PlatformComponent('D04-01')
export class PipelineRunService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly errors: IntegrationErrorService,
  ) {}

  /**
   * 실행 결과 받기 — 같은 실행 ID는 마지막 상태로 덮는다(시작 → 성공·실패). 끝난 실행을 다시 시작으로 되돌리지 않는다.
   * @req FR-CICD-001-001, FR-CICD-001-002, FR-CICD-001-003
   */
  record(actor: Actor, body: PipelineRunBody): PipelineRun {
    const prev = this.db.get<{ status: string }>('SELECT status FROM pipeline_run WHERE run_id = ?', body.runId);
    if (prev && prev.status !== 'STARTED' && body.status === 'STARTED') throw new DomainError('CONFLICT', `${body.runId} 실행은 이미 ${prev.status}로 끝났습니다.`);
    if (body.featureId && !this.db.get('SELECT 1 FROM feature_version WHERE feature_id = ? LIMIT 1', body.featureId)) throw new DomainError('NOT_FOUND', `${body.featureId}을(를) 찾을 수 없습니다.`);
    const run: PipelineRun = { ...body, receivedAt: this.clock.iso(), receivedBy: actor.id };
    this.db.tx(() => {
      this.db.run(
        'INSERT INTO pipeline_run (run_id, feature_id, status, received_at, doc) VALUES (?, ?, ?, ?, ?) ON CONFLICT (run_id) DO UPDATE SET feature_id = excluded.feature_id, status = excluded.status, received_at = excluded.received_at, doc = excluded.doc',
        run.runId,
        run.featureId ?? null,
        run.status,
        run.receivedAt,
        JSON.stringify(run),
      );
      this.audit.record(actor, 'PIPELINE_RUN', run.runId, { before: prev ? { status: prev.status } : undefined, after: { status: run.status, stage: run.stage ?? null, environment: run.environment }, reason: run.reason, componentId: 'D04-01' });
      this.events.publish('pipeline.run.recorded', run.runId, { runId: run.runId, status: run.status, featureId: run.featureId ?? null, environment: run.environment }, { componentId: 'D04-01', correlationId: actor.correlationId });
    });
    // 실패는 오류 이력 + 알림(이벤트 pipeline.run.failed) — 실행 기록과 별도 트랜잭션(오류 기록 규칙)
    if (run.status === 'FAILED')
      this.errors.record(actor, { system: 'PIPELINE', errorType: 'PIPELINE_FAILED', target: run.runId, message: `${run.pipeline} · ${run.environment} · ${run.stage} 단계 — ${run.reason}`, featureId: run.featureId ?? null, at: run.finishedAt, detail: { runId: run.runId, pipeline: run.pipeline, environment: run.environment, stage: run.stage, reason: run.reason, finishedAt: run.finishedAt ?? null } });
    return run;
  }

  list(q: { featureId?: string; status?: string } = {}): PipelineRun[] {
    const where: string[] = [];
    const params: string[] = [];
    if (q.featureId) (where.push('feature_id = ?'), params.push(q.featureId));
    if (q.status) (where.push('status = ?'), params.push(q.status));
    return this.db.all<{ doc: string }>(`SELECT doc FROM pipeline_run ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY received_at DESC LIMIT 200`, ...params).map((r) => JSON.parse(r.doc) as PipelineRun);
  }
}

@Controller('api/pipeline/runs')
export class PipelineRunController {
  constructor(private readonly runs: PipelineRunService) {}

  @Get()
  list(@Query('featureId') featureId?: unknown, @Query('status') status?: unknown) {
    const s = singleQuery(status, 'status')?.trim() || undefined;
    if (s && !(PIPELINE_RUN_STATUSES as readonly string[]).includes(s)) throw new DomainError('VALIDATION', `알 수 없는 실행 상태입니다: ${s}`, { field: 'status' });
    return { items: this.runs.list({ featureId: singleQuery(featureId, 'featureId')?.trim() || undefined, status: s }) };
  }

  @Post()
  @HttpCode(201)
  @Roles('IMPLEMENTER', 'SYSTEM')
  @AuditAction('PIPELINE_RUN')
  record(@CurrentActor() actor: Actor, @Body(new ZodPipe(PipelineRunBody)) body: PipelineRunBody) {
    return this.runs.record(actor, body);
  }
}
