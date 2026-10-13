// P10 확장 모듈 — 실험·효과(D01-07)·장애·VOC(D04-05)·데이터 동기화(D05-02)·Legacy 연계(D05-03)·현장 지원 포털(D05-05)·Legacy-SDV(D05-07)
// 그리고 외부 연계 모의 어댑터(IF-01·02·03·08·11·12). 이상 징후(D06-12)와는 이벤트로만 묶인다(incident.sotif.triggered).
import { Module } from '@nestjs/common';
import { ExternalSystems } from '../adapters/if-mocks/external-systems';
import { IntegrationController } from '../adapters/if-mocks/integration.controller';
import { OtelExporter } from '../adapters/if-mocks/otel.exporter';
import { D01PolicyModule } from './d01-policy/d01-policy.module';
import { ExperimentController, ExperimentRepo, ExperimentService } from './d01-policy/experiment/experiment.service';
import { IncidentController, IncidentService } from './d04-ops/incident-voc/incident.service';
import { SyncController, SyncService } from './d05-ext/data-sync/sync.service';
import { FieldPortalController, FieldPortalService } from './d05-ext/field-portal/field.service';
import { LegacySdvController, LegacySdvService } from './d05-ext/legacy-sdv/legacy-sdv.service';
import { LegacyController, LegacyService } from './d05-ext/legacy/legacy.service';
import { OpsLoopModule } from './ops-loop.module';

@Module({
  imports: [D01PolicyModule, OpsLoopModule],
  controllers: [IntegrationController, ExperimentController, IncidentController, SyncController, LegacyController, LegacySdvController, FieldPortalController],
  providers: [OtelExporter, ExternalSystems, ExperimentRepo, ExperimentService, IncidentService, SyncService, LegacyService, LegacySdvService, FieldPortalService],
  exports: [ExternalSystems, IncidentService, ExperimentService],
})
export class ExtModule {}
