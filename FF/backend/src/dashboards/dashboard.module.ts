// 대시보드 모듈 — Jira식 가젯 판 저장(소유·공유·버전). 저장·감사는 커널을 쓴다.
import { Module } from '@nestjs/common';
import { DashboardController, DashboardService } from './dashboard.service';
import { DashboardDefaultController, DashboardDefaultService } from './dashboard-default.service';

@Module({
  controllers: [DashboardController, DashboardDefaultController],
  providers: [DashboardService, DashboardDefaultService],
})
export class DashboardModule {}
