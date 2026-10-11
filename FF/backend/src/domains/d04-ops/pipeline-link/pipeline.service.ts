// 배포 파이프라인 연계 (D04-01) — IF-13 CI/CD 산출물 등록 + IF-05 배포 캠페인 요청(CCS/OTA) 모의 어댑터.
// 외부 호출은 IF별 멱등 키(게시본 ID)로 기록해 같은 게시본을 두 번 요청하지 않는다. 플랫폼은 요청만 보내고 차량 전개는 OTA가 한다.
import { Controller, Get, Injectable, Query } from '@nestjs/common';
import type { Publication } from '@ff/contracts';
import { PlatformComponent } from '../../../kernel/components';
import { IfCallRepo, type IfCall } from '../../../adapters/if-call/if-call.repo';
import { VehicleRuntimeService } from '../../d02-runtime/vehicle-runtime/vehicle-runtime.service';

@Injectable()
@PlatformComponent('D04-01')
export class PipelineService {
  constructor(
    private readonly ifCalls: IfCallRepo,
    private readonly runtime: VehicleRuntimeService,
  ) {}

  /** 게시본 전개 요청 — IF-13 산출물 → IF-05 캠페인 → (OTA가 수행하는) IF-07 차량 전개 */
  dispatch(pub: Publication): { campaignId: string; ackOnly: string[]; unreachable: string[] } {
    const p = pub.payload;
    this.ifCalls.call('IF-13', pub.publicationId, { artifact: `${p.kind}:${p.flagKey ?? p.featureId}#${p.sequence}`, payloadHash: pub.signature.payloadHash }, () => ({ artifactId: `ART-${pub.publicationId.slice(4)}`, stored: true }));
    const n = this.ifCalls.next('IF-05');
    const campaign = this.ifCalls.call(
      'IF-05',
      pub.publicationId,
      { channel: pub.channel === 'EMERGENCY' ? 'CCS' : 'OTA', priority: pub.channel === 'EMERGENCY' ? 'EMERGENCY' : 'NORMAL', targets: p.targets.length, signatureKeyId: pub.signature.keyId },
      () => ({ campaignId: `CMP-${String(n).padStart(5, '0')}`, accepted: true }),
    );
    const { ackOnly, unreachable } = this.runtime.deliver(pub);
    return { campaignId: campaign.campaignId, ackOnly, unreachable };
  }

  calls(q: { ifId?: string; key?: string } = {}): IfCall[] {
    return this.ifCalls.list(q);
  }
}

@Controller('api/integrations')
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get('calls')
  calls(@Query('ifId') ifId?: string, @Query('key') key?: string) {
    return { items: this.pipeline.calls({ ifId, key }) };
  }
}
