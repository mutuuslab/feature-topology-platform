// 오류 이력 모듈 — 커널(DB·시계·이벤트)만 쓰므로 Legacy·과금·정책 배포·파이프라인 모듈 어디서 가져와도 순환이 없다.
import { Module } from '@nestjs/common';
import { IntegrationErrorController, IntegrationErrorService } from './integration-error.service';

@Module({
  controllers: [IntegrationErrorController],
  providers: [IntegrationErrorService],
  exports: [IntegrationErrorService],
})
export class IntegrationErrorModule {}
