// IF-11 OpenTelemetry Collector 모의 — span을 otel_span 표에 쌓는다(외부 연계 현황·OpenFeature 범위 화면이 읽는다).
// IF_MODE_11=off면 버린다(평가는 계속된다 — 관측 경로가 끊겨도 기능 판단에 영향이 없어야 한다).
// 평가 span은 지표(ff_flag_evaluations_total)로도 세고, OTLP 내보내기가 켜져 있으면 Tempo로 보낸다(가명 속성 제외, 80-80).
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { OtelSpan } from '@ff/contracts';
import { DB, type Db } from '../../kernel/db';
import { OtlpExporter } from '../../kernel/otlp/otlp-exporter';
import { otlpSpanOf, TelemetryMetrics } from '../../kernel/telemetry-metrics';
import { countEvaluations, samplesOfSpans } from '../../domains/d04-ops/telemetry-ingest/evaluation-stats.service';

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
    // 평가 집계 한 저장소(D04-03, 통합 D-INT-2) — 수집기가 꺼져도 평가 횟수는 센다(관측 경로와 집계는 따로).
    // 정본은 flag_eval_hourly — Feature 평가 운영·Flag 평가 모니터링이 함께 읽는다. 위 지표(ff_flag_evaluations_total)는 같은 span의 노출일 뿐 따로 더하지 않는다
    countEvaluations(this.db, samplesOfSpans(spans));
    if (process.env.IF_MODE_11 === 'off' || !spans.length) return 0;
    for (const s of spans) this.db.run('INSERT INTO otel_span (trace_id, name, at, doc) VALUES (?, ?, ?, ?)', s.traceId, s.name, s.startTime, JSON.stringify(s));
    return spans.length;
  }
}
