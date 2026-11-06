// ADS 구성(ODD 프로파일·호환 형상·VIN 지원 판정) — 서비스·컨트롤러를 여기에 등록한다
import { Module } from '@nestjs/common';
import { D01PolicyModule } from './d01-policy/d01-policy.module';
import { EligibilityController, EligibilityService } from './d02-runtime/support-conditions/eligibility.service';
import { AdsConfigController, AdsConfigService } from './d02-runtime/variant-conditions/ads-config.service';

@Module({ imports: [D01PolicyModule], controllers: [AdsConfigController, EligibilityController], providers: [AdsConfigService, EligibilityService], exports: [AdsConfigService, EligibilityService] })
export class AdsConfigModule {}
