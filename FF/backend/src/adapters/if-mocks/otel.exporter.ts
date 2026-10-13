// IF-11 OpenTelemetry Collector 모의 — span을 otel_span 표에 쌓는다(외부 연계 현황·OpenFeature 범위 화면이 읽는다).
// IF_MODE_11=off면 버린다(평가는 계속된다 — 관측 경로가 끊겨도 기능 판단에 영향이 없어야 한다).
import { Inject, Injectable } from '@nestjs/common';
import type { OtelSpan } from '@ff/contracts';
import { DB, type Db } from '../../kernel/db';

@Injectable()
export class OtelExporter {
  constructor(@Inject(DB) private readonly db: Db) {}

  export(spans: OtelSpan[]): number {
    if (process.env.IF_MODE_11 === 'off' || !spans.length) return 0;
    for (const s of spans) this.db.run('INSERT INTO otel_span (trace_id, name, at, doc) VALUES (?, ?, ?, ?)', s.traceId, s.name, s.startTime, JSON.stringify(s));
    return spans.length;
  }
}
