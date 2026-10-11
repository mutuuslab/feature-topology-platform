// 04. 배포·운영·데이터 도메인 — 컴포넌트는 단계별로 채운다 (contracts manifest 참고).
import { Module } from '@nestjs/common';
import { EventHistoryController, EventHistoryService } from './event-history/event-history.controller';

@Module({
  controllers: [EventHistoryController],
  providers: [EventHistoryService],
  exports: [EventHistoryService],
})
export class D04OpsModule {}
