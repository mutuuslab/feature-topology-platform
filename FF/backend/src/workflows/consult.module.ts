// 검토 포털 협의 요청 모듈(W5, P5-1) — 저장·감사·이벤트는 커널을 쓴다(마이그레이션 087).
import { Module } from '@nestjs/common';
import { ConsultController, ConsultService } from './consult.service';

@Module({
  controllers: [ConsultController],
  providers: [ConsultService],
  exports: [ConsultService],
})
export class ConsultModule {}
