// 기능 지원 조건 관리 (D02-02) — 차량 하나가 배포된 Feature들을 실행할 수 있는가(대상 ECU SW ≥ 기능 앱 SW 요구 Version).
// PoC ⑤ 차량 평가 단계에서 "켜져 있지만 이 차량은 지원하지 않는" 경우를 미리 드러낸다.
import { Controller, Get, Injectable, Param } from '@nestjs/common';
import { variantRow } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import { DomainError } from '../../../kernel/errors';
import { FleetRepo, PolicyRepo } from '../../d01-policy/policy-repos';
import { FeatureRepo } from '../../d01-policy/repos';

@Injectable()
@PlatformComponent('D02-02')
export class SupportConditionsService {
  constructor(
    private readonly features: FeatureRepo,
    private readonly fleet: FleetRepo,
    private readonly policies: PolicyRepo,
  ) {}

  forVehicle(vin: string) {
    const v = this.fleet.vehicle(vin);
    if (!v) throw new DomainError('NOT_FOUND', `차량 ${vin}을(를) 찾을 수 없습니다.`);
    const deployed = this.policies.all().filter((p) => p.status === 'DEPLOYED');
    const keys = [...new Set(deployed.map((p) => `${p.featureId}@${p.featureVersion}`))];
    const items = keys.flatMap((key) => {
      const [featureId, version] = key.split('@');
      const f = this.features.get(featureId, version);
      if (!f) return [];
      const flagKeys = deployed.filter((x) => x.featureId === featureId && x.featureVersion === version).map((x) => x.flagKey);
      return [{ featureId, version, name: f.name, flagKeys, ...variantRow({ ...f, featureId, version }, v) }];
    });
    return { vehicle: { vin: v.vin, label: v.label, swVersion: v.swVersion, upgVc: v.upgVc, quality: v.quality }, items };
  }
}

@Controller('api/support')
export class SupportConditionsController {
  constructor(private readonly support: SupportConditionsService) {}

  @Get(':vin')
  forVehicle(@Param('vin') vin: string) {
    return this.support.forVehicle(vin);
  }
}
