// IF-11 OpenTelemetry Collector 모의 — span을 otel_span 표에 쌓는다(외부 연계 현황·OpenFeature 범위 화면이 읽는다).
// IF_MODE_11=off면 버린다(평가는 계속된다 — 관측 경로가 끊겨도 기능 판단에 영향이 없어야 한다).
// 평가 span은 지표(ff_flag_evaluations_total)로도 세고, OTLP 내보내기가 켜져 있으면 Tempo로 보낸다(가명 속성 제외, 80-80).
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { OtelSpan } from '@ff/contracts';
import { DB, type Db } from '../../kernel/db';
import { OtlpExporter } from '../../kernel/otlp/otlp-exporter';
import { otlpSpanOf, TelemetryMetrics } from '../../kernel/telemetry-metrics';

@Injectable()
export class OtelExporter {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() private readonly metrics?: TelemetryMetrics,
    @Optional() private readonly otlp?: OtlpExporter,
  ) {}

  export(spans: OtelSpan[]): number {
    this.metrics?.evaluations(spans);
    if (this.otlp?.enabled) for (const s of spans) {
      const o = otlpSpanOf(s);
      if (o) this.otlp.span(o);
    }
    if (process.env.IF_MODE_11 === 'off' || !spans.length) return 0;
    for (const s of spans) this.db.run('INSERT INTO otel_span (trace_id, name, at, doc) VALUES (?, ?, ?, ?)', s.traceId, s.name, s.startTime, JSON.stringify(s));
    return spans.length;
  }
}
