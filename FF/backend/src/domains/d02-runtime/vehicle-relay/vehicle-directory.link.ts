// 차량 원장(가명 → VIN)을 차량 요청 인증에 잇는다(TL-M02) — Lake 중계 메시지(FFV1-MSG)에는 VIN이 없고 가명만 있다(80-75 3.4).
// 커널(VehicleAuthService)이 도메인 저장소에 의존하지 않게 원장 쪽이 알려 준다(HSM의 useKeySource와 같은 방식).
import { Injectable, OnModuleInit } from '@nestjs/common';
import { VehicleAuthService } from '../../../kernel/vehicle-auth';
import { FleetRepo } from '../../d01-policy/policy-repos';

@Injectable()
export class VehicleDirectoryLink implements OnModuleInit {
  constructor(
    private readonly auth: VehicleAuthService,
    private readonly fleet: FleetRepo,
  ) {}

  onModuleInit() {
    this.auth.useVehicleDirectory({ vinByPseudonym: (p) => this.fleet.vinByPseudonym(p) ?? null });
  }
}
