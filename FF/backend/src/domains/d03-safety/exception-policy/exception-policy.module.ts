// 예외 정책 층(D03-02, GX) — 요청·2인 승인·만료 원복과 배포 검사 예외. 정책 배포(PolicyModule)가 이 모듈을 가져와 검사마다 묻는다
import { Module } from '@nestjs/common';
import { D01PolicyModule } from '../../d01-policy/d01-policy.module';
import { DeliveryModule } from '../../delivery.module';
import { ExceptionPolicyController, ExceptionPolicyService, ExceptionRepo, PolicyReleaseGateController } from './exception-policy.service';

@Module({
  imports: [D01PolicyModule, DeliveryModule],
  controllers: [ExceptionPolicyController, PolicyReleaseGateController],
  providers: [ExceptionRepo, ExceptionPolicyService],
  exports: [ExceptionPolicyService],
})
export class ExceptionPolicyModule {}
