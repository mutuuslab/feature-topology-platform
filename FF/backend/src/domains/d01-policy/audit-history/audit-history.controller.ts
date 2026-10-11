// 감사 이력 관리 (D01-10) — 커널 AuditService(쓰기는 각 변경 tx 안에서)의 조회 창구.
import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { AuditService, type AuditQuery, type AuditResult } from '../../../kernel/audit.service';
import { PlatformComponent } from '../../../kernel/components';

@Injectable()
@PlatformComponent('D01-10')
export class AuditHistoryService {
  constructor(private readonly audit: AuditService) {}
  list(q: AuditQuery) {
    return this.audit.list(q);
  }
}

@Controller('api/audit')
export class AuditHistoryController {
  constructor(private readonly history: AuditHistoryService) {}

  @Get()
  list(@Query('target') target?: string, @Query('actorId') actorId?: string, @Query('result') result?: AuditResult, @Query('limit') limit?: string) {
    return { items: this.history.list({ target, actorId, result, limit: limit ? Number(limit) : undefined }) };
  }
}
