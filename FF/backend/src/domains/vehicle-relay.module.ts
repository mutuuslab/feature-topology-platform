// 차량 중계 기반 모듈(P9) — Data Lake 중계 메시지 검증 준비(TL-M02)·OTA 전달 대사·차량 정책 캐시 조회.
// 수신 경로(상태 보고 수신·전달 채널)는 그대로 두고 새 파일만 둔다. 중계 소비자(TL-M04)는 이 모듈 위에 붙는다.
import { Module } from '@nestjs/common';
import { OtaJobRepo } from '../adapters/ota/ota-job.repo';
import { OtaReconcileController, OtaReconcileService } from '../adapters/ota/ota-reconcile.service';
import { DeliveryModule } from './delivery.module';
import { OpsLoopModule } from './ops-loop.module';
import { D01PolicyModule } from './d01-policy/d01-policy.module';
import { VehicleDirectoryLink } from './d02-runtime/vehicle-relay/vehicle-directory.link';

@Module({
  imports: [D01PolicyModule, DeliveryModule, OpsLoopModule],
  controllers: [OtaReconcileController],
  providers: [VehicleDirectoryLink, OtaJobRepo, OtaReconcileService],
})
export class VehicleRelayModule {}
