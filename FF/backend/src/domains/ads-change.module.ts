// ADS 변경(변경 종류·승인 영향·릴리스 비교·분류) — 서비스·컨트롤러를 여기에 등록한다
import { Module } from '@nestjs/common';
import { D01PolicyModule } from './d01-policy/d01-policy.module';
import { AdsClassificationController, AdsClassificationService } from './d01-policy/registry/ads-classification.service';
import { AdsExpansionController, AdsExpansionService } from './d01-policy/staged-rollout/ads-expansion.service';
import { AdsChangeImpactController, AdsChangeService, AdsReleaseController } from './d06-qsec/change-impact-validation/ads-change.service';

@Module({
  imports: [D01PolicyModule],
  controllers: [AdsChangeImpactController, AdsReleaseController, AdsClassificationController, AdsExpansionController],
  providers: [AdsChangeService, AdsClassificationService, AdsExpansionService],
  exports: [AdsChangeService, AdsClassificationService],
})
export class AdsChangeModule {}
