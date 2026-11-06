// 04. 배포·운영·데이터 도메인 — 컴포넌트는 단계별로 채운다 (contracts manifest 참고).
import { Module } from '@nestjs/common';
import { D01PolicyModule } from '../d01-policy/d01-policy.module';
import { EventHistoryController, EventHistoryService } from './event-history/event-history.controller';
import { NotificationController, NotificationService } from './event-history/notification.service';
import { GrafanaAlertController, GrafanaAlertService } from './ops-observation/grafana-alert.service';

@Module({
  imports: [D01PolicyModule],
  controllers: [EventHistoryController, NotificationController, GrafanaAlertController],
  providers: [EventHistoryService, NotificationService, GrafanaAlertService],
  exports: [EventHistoryService, NotificationService],
})
export class D04OpsModule {}
