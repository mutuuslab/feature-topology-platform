// 변경 기록 (D04-01 배포 파이프라인 연계, IF-13 · FFG-CODE-030) — CI/CD가 SW Version마다 변경 기록(커밋·AI 생성 표시와 도구·Version·범위·
// 검토·정적 분석·시험·커버리지 근거)을 등록한다(036, 추가만 — 근거 보완은 같은 변경 ID의 새 개정, 최신 개정으로 판정). 감사는 근거 누락·커버리지 미달을 AI 여부와 무관하게 같은 기준으로 찾고,
// 그 SW Version을 쓰는 Feature의 G5(Verification Gate) PASS는 발견이 남아 있으면 판정되지 않는다(gate.service).
import { Body, Controller, Get, HttpCode, Inject, Injectable, Post, Query } from '@nestjs/common';
import { ChangeRecordBody, changeRecordFindings } from '@ff/contracts';
import { AuditAction, CurrentActor, Roles, type Actor } from '../../../kernel/actor';
import { AuditService } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DB, type Db } from '../../../kernel/db';
import { DomainError } from '../../../kernel/errors';
import { EventService } from '../../../kernel/event.service';
import { ZodPipe } from '../../../kernel/zod.pipe';

@Injectable()
@PlatformComponent('D04-01')
export class ChangeRecordService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly events: EventService,
    private readonly clock: Clock,
  ) {}

  register(actor: Actor, body: ChangeRecordBody) {
    const prev = this.db.get<{ rev: number; sw_id: string; sw_version: string }>('SELECT rev, sw_id, sw_version FROM change_record WHERE change_id = ? ORDER BY rev DESC LIMIT 1', body.changeId);
    // 개정은 근거 보완만 — 다른 SW Version으로 옮길 수 없다
    if (prev && (prev.sw_id !== body.swId || prev.sw_version !== body.swVersion)) throw new DomainError('CONFLICT', `${body.changeId}은(는) ${prev.sw_id} ${prev.sw_version}의 변경입니다.`);
    const rev = (prev?.rev ?? 0) + 1;
    const at = this.clock.iso();
    const findings = changeRecordFindings(body);
    this.db.tx(() => {
      this.db.run('INSERT INTO change_record (change_id, rev, sw_id, sw_version, ai, at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', body.changeId, rev, body.swId, body.swVersion, body.aiGenerated ? 1 : 0, at, JSON.stringify({ ...body, registeredBy: actor.id }));
      this.audit.record(actor, 'CHANGE_RECORD', body.changeId, { after: { rev, swId: body.swId, swVersion: body.swVersion, aiGenerated: body.aiGenerated, findings }, componentId: 'D04-01' });
      this.events.publish('change.recorded', body.changeId, { swId: body.swId, swVersion: body.swVersion, ai: !!body.aiGenerated, findings }, { componentId: 'D04-01', correlationId: actor.correlationId });
    });
    return { ...body, rev, at, findings };
  }

  /** 변경 기록 감사 — AI 표시 변경 중 근거가 모두 있는 비율 */
  list(q: { swId?: string }) {
    const items = this.db
      .all<{ doc: string; at: string; rev: number }>(
        `SELECT c.doc, c.at, c.rev FROM change_record c WHERE c.rev = (SELECT MAX(rev) FROM change_record x WHERE x.change_id = c.change_id) ${q.swId ? 'AND c.sw_id = ?' : ''} ORDER BY c.at DESC, c.change_id DESC`,
        ...(q.swId ? [q.swId] : []),
      )
      .map((r) => {
        const d = JSON.parse(r.doc) as ChangeRecordBody;
        return { ...d, rev: r.rev, at: r.at, findings: changeRecordFindings(d) };
      });
    const ai = items.filter((x) => x.aiGenerated);
    return { items, summary: { total: items.length, aiGenerated: ai.length, aiComplete: ai.filter((x) => !x.findings.length).length, withFindings: items.filter((x) => x.findings.length).length } };
  }
}

@Controller('api')
export class ChangeRecordController {
  constructor(private readonly svc: ChangeRecordService) {}

  @Get('change-records')
  list(@Query('swId') swId?: string) {
    return this.svc.list({ swId });
  }

  @Post('change-records')
  @HttpCode(201)
  @Roles('IMPLEMENTER', 'SYSTEM')
  @AuditAction('CHANGE_RECORD')
  register(@CurrentActor() actor: Actor, @Body(new ZodPipe(ChangeRecordBody)) body: ChangeRecordBody) {
    return this.svc.register(actor, body);
  }
}
