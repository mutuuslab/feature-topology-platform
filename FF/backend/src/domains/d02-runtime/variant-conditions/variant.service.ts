// Variant 조건 관리 (D02-01) — Feature Version이 맞는 차량 사양(국가·차종·트림·UPG-VC)과 지원 조건(D02-02)을 Fleet에 대 본 매트릭스.
// 판정 규칙은 contracts variant.ts. 서버 평가기(P0 이식)는 바꾸지 않는다 — 이 결과는 배포 대상 설명·정책 검증 참고(INFO)에 쓴다.
import { Controller, Get, Injectable, Param } from '@nestjs/common';
import { variantMatrix } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import { DomainError } from '../../../kernel/errors';
import { FleetRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo } from '../../d01-policy/repos';

@Injectable()
@PlatformComponent('D02-01')
export class VariantConditionsService {
  constructor(
    private readonly features: FeatureRepo,
    private readonly fleet: FleetRepo,
  ) {}

  matrix(featureId: string, version: string) {
    const f = this.features.get(featureId, version);
    if (!f) throw new DomainError('NOT_FOUND', `${featureId} ${version}을(를) 찾을 수 없습니다.`);
    return { feature: { featureId, version, name: f.name, lifecycle: f.lifecycle }, ...variantMatrix({ ...f, featureId, version }, this.fleet.vehicles()) };
  }
}

@Controller('api/variants')
export class VariantConditionsController {
  constructor(private readonly variants: VariantConditionsService) {}

  @Get(':featureId/:version')
  matrix(@Param('featureId') featureId: string, @Param('version') version: string) {
    return this.variants.matrix(featureId, version);
  }
}
