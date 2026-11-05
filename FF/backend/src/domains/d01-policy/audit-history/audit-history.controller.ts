// 감사 이력 관리 (D01-10) — 커널 AuditService(쓰기는 각 변경 tx 안에서)의 조회 창구.
import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { AuditService, type AuditQuery, type AuditResult } from '../../../kernel/audit.service';
import { Clock } from '../../../kernel/clock';
import { PlatformComponent } from '../../../kernel/components';
import { DomainError } from '../../../kernel/errors';
import { decodeCursor, encodeCursor, singleQuery } from '../../../kernel/paging';

@Injectable()
@PlatformComponent('D01-10')
export class AuditHistoryService {
  constructor(
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}
  list(q: AuditQuery) {
    return this.audit.list(q);
  }
  /** 감사 체인 검증 — 묶음으로 나눠 이벤트 루프를 막지 않는다(AuditService.verifyChainAsync). 검증 시각을 붙인다(화면 '마지막 검증', P5-10) */
  async chain() {
    const r = await this.audit.verifyChainAsync();
    return { ...r, checkedAt: this.clock.iso() };
  }
}

@Controller('api/audit')
export class AuditHistoryController {
  constructor(private readonly history: AuditHistoryService) {}

  @Get()
  list(@Query('target') target?: string, @Query('actorId') actorId?: string, @Query('result') result?: AuditResult, @Query('limit') limit?: string, @Query('cursor') cursor?: string, @Query('targetPrefix') targetPrefix?: unknown, @Query('action') action?: unknown) {
    // 최신순 키셋 커서 — cursor는 이전 페이지 마지막 id(불투명 문자열). cursor가 없으면 예전과 같다(출시 준비 RD-UX-03)
    let before: number | undefined;
    // 배열·객체(같은 이름 두 번·a[b]=c)는 VALIDATION — 문자열 하나만
    const lim = singleQuery(limit, 'limit');
    if (cursor !== undefined && cursor !== '') {
      const c = decodeCursor(cursor);
      if (!c || typeof c.id !== 'number' || !Number.isInteger(c.id)) throw new DomainError('VALIDATION', '목록 커서를 읽을 수 없습니다. 처음 페이지부터 다시 불러오세요.', { field: 'cursor' });
      before = c.id;
    }
    const n = Math.min(lim ? Number(lim) || 200 : 200, 1000);
    // 앞부분 검색·행위 필터(W5 P5-6) — 문자열 하나만
    const prefix = singleQuery(targetPrefix, 'targetPrefix')?.trim() || undefined;
    const act = singleQuery(action, 'action')?.trim() || undefined;
    const items = this.history.list({ target, actorId, result, limit: n, before, targetPrefix: prefix, action: act });
    const last = items[items.length - 1];
    return { items, nextCursor: items.length === n && last ? encodeCursor({ id: last.id }) : null };
  }

  @Get('chain')
  chain() {
    return this.history.chain();
  }
}
