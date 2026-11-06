// ADS 증거(ADS 사건 보고·Safety Case·요구 추적) — 서비스·컨트롤러를 여기에 등록한다
import { Module } from '@nestjs/common';
import { D01PolicyModule } from './d01-policy/d01-policy.module';
import { AdsIncidentReportController, AdsIncidentReportService, AdsPeriodicReportController } from './d04-ops/incident-voc/ads-incident-report.service';
import { AdsEvidenceManifestController, AdsReviewFindingController, AdsSafetyCaseController, AdsSafetyCaseService } from './d06-qsec/safety-req-trace/ads-safety-case.service';
import { AdsTraceController } from './d06-qsec/safety-req-trace/ads-trace.controller';

@Module({
  imports: [D01PolicyModule],
  controllers: [AdsIncidentReportController, AdsPeriodicReportController, AdsSafetyCaseController, AdsEvidenceManifestController, AdsReviewFindingController, AdsTraceController],
  providers: [AdsIncidentReportService, AdsSafetyCaseService],
})
export class AdsEvidenceModule {}
