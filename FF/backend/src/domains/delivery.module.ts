// 배포·차단 전달 모듈 (PoC ④⑤⑥) — 도메인을 가로지르는 한 흐름이라 한 모듈로 묶는다:
// 보안 배포(D06-08)·PKI(D06-10) → 배포 파이프라인(D04-01, IF-05/13) → 차량 런타임(D02-03, IF-07)·GLEO
// → 운영 데이터 수집(D04-03, IF-06) → 회신 집계. 긴급 차단(D03-03)·이전 상태 복구(D03-04)가 같은 경로를 쓴다.
// 의존 방향: 수집 → ReadbackBus → 보안 배포 (순환 없음).
// 차량 발신 요청(조회·보고)도 여기 — 회신은 수집(D04-03)으로, 재연결 대사는 게시본(D06-08)을 읽는다.
import { Module } from '@nestjs/common';
import { GleoAdapter, GleoController } from '../adapters/gleo/gleo.adapter';
import { D01PolicyModule } from './d01-policy/d01-policy.module';
import { VehicleRequestRepo } from './d02-runtime/vehicle-requests/vehicle-request.repo';
import { VehicleRequestController, VehicleRequestLogController, VehicleRequestService } from './d02-runtime/vehicle-requests/vehicle-request.service';
import { VehicleRuntimeController, VehicleRuntimeService } from './d02-runtime/vehicle-runtime/vehicle-runtime.service';
import { VariantConditionsController, VariantConditionsService } from './d02-runtime/variant-conditions/variant.service';
import { SupportConditionsController, SupportConditionsService } from './d02-runtime/support-conditions/support.service';
import { KillController, KillService } from './d03-safety/kill-switch/kill.service';
import { RestoreController, RestoreService } from './d03-safety/restore/restore.service';
import { PipelineController, PipelineService } from './d04-ops/pipeline-link/pipeline.service';
import { ReadbackBus, TelemetryController, TelemetryService } from './d04-ops/telemetry-ingest/telemetry.service';
import { PkiController, PkiService } from './d06-qsec/pki-kms/pki.service';
import { PublicationRepo, RuntimeRepo } from './d06-qsec/secure-deploy/publication.repo';
import { PublicationController, SecureDeployService } from './d06-qsec/secure-deploy/secure-deploy.service';

@Module({
  imports: [D01PolicyModule],
  controllers: [PkiController, PublicationController, PipelineController, TelemetryController, VehicleRuntimeController, VehicleRequestController, VehicleRequestLogController, GleoController, KillController, RestoreController, VariantConditionsController, SupportConditionsController],
  providers: [PublicationRepo, RuntimeRepo, ReadbackBus, PkiService, TelemetryService, GleoAdapter, VehicleRuntimeService, VehicleRequestRepo, VehicleRequestService, PipelineService, SecureDeployService, KillService, RestoreService, VariantConditionsService, SupportConditionsService],
  exports: [SecureDeployService, PkiService, VehicleRuntimeService, GleoAdapter],
})
export class DeliveryModule {}
