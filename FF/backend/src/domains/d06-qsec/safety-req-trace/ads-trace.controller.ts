// ADS·UNECE 요구 추적 (D06-07, ADS-UI10) — 생성 파일(tools/ads-trace.ts)을 그대로 서빙한다. 런타임에 harness를 읽지 않는다.
// 판정(구현·부분·미구현·범위 밖·근거 없음·미판정)은 화면이 contracts traceVerdict로 계산한다 — 플랫폼 구현 현황이지 차량 인증 상태가 아니다.
import { Controller, Get } from '@nestjs/common';
import { traceSummary } from '@ff/contracts';
import { ADS_TRACE } from '../../../generated/ads-trace';

@Controller('api/ads/trace')
export class AdsTraceController {
  @Get()
  trace() {
    return { ...ADS_TRACE, summary: traceSummary(ADS_TRACE) };
  }
}
