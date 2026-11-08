// 긴급 차단 대응 모듈(P11a) — 차단 요청 접수(외부 시스템·이상 징후 조건 충족)·비활성화 조건 확인·종료 사건 차단 집합·영향 차량 산정.
// 차단·복원 본체(KillService·RestoreService)는 전달 모듈(DeliveryModule)에 있고, 여기서는 그 위의 접수·사건 단위 조회만 둔다.
import { Module } from '@nestjs/common';
import { D01PolicyModule } from './d01-policy/d01-policy.module';
import { DeliveryModule } from './delivery.module';
import { ImpactSetController, ImpactSetService, RescindController, TerminationController, TerminationService } from './d03-safety/kill-switch/termination.service';
import { DeactivationCheckController, DeactivationCheckService, ExtKillIntakeController, KillIntakeController, KillIntakeService } from './d03-safety/kill-switch/kill-intake.service';


@Module({
  imports: [D01PolicyModule, DeliveryModule],
  controllers: [ExtKillIntakeController, KillIntakeController, DeactivationCheckController, TerminationController, RescindController, ImpactSetController],
  providers: [KillIntakeService, DeactivationCheckService, TerminationService, ImpactSetService],
  exports: [KillIntakeService],
})
export class KillResponseModule {}
