// ADS 상태(6축·수렴·행위별 판정·고객 상태·주문 추적) — 서비스·컨트롤러를 여기에 등록한다
import { Module } from '@nestjs/common';
import { AdsConvergenceController, AdsFleetAxisController, AdsStateService, AdsVehicleStateController } from './d02-runtime/vehicle-runtime/ads-state.service';
import { AdsOrderController, AdsOrderService } from './d05-ext/billing/ads-orders.service';

@Module({ imports: [], controllers: [AdsVehicleStateController, AdsConvergenceController, AdsFleetAxisController, AdsOrderController], providers: [AdsStateService, AdsOrderService], exports: [AdsStateService] })
export class AdsStateModule {}
