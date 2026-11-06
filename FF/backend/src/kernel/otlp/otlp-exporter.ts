// OTLP/HTTP 내보내기(추적·로그) — OTEL_EXPORTER_OTLP_ENDPOINT가 있을 때만 켠다(80-80). 보통 같은 설치의 Grafana Alloy(:4318)로 보내고,
// Alloy가 Grafana Cloud OTLP 게이트웨이로 넘긴다. 내보내기가 실패해도 기능 판단·요청 처리에 영향이 없다(버리고 센다).
// 개인정보: VIN·가명·사람 ID를 싣지 않는다 — 넣는 쪽(TelemetryMetrics·OtelExporter)이 거른 속성만 받는다.
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { gzipSync } from 'node:zlib';
import { decodePartialSuccess, encodeLogs, encodeTraces, type OtlpAttrs, type OtlpLogRecord, type OtlpSpan } from './otlp-proto';

type Env = Record<string, string | undefined>;

/** OTEL_EXPORTER_OTLP_HEADERS — "k=v,k2=v2"(값은 URL 인코딩 허용) */
export function otlpHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (raw ?? '').split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function otlpConfig(env: Env = process.env) {
  const base = (env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').replace(/\/$/, '');
  if (!base) return null;
  const u = new URL(base);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT는 http(s) 주소여야 합니다.');
  return {
    base,
    headers: otlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    resource: {
      'service.name': env.OTEL_SERVICE_NAME || 'ff-platform',
      'service.namespace': 'ff',
      'service.instance.id': env.FF_INSTANCE_ID || 'ff',
      'deployment.environment': env.FF_ENV || 'demo',
    } as OtlpAttrs,
  };
}

const MAX_QUEUE = 2000;
const BATCH = 500;

@Injectable()
export class OtlpExporter implements OnModuleDestroy {
  private readonly cfg = otlpConfig();
  private spans: OtlpSpan[] = [];
  private logs: OtlpLogRecord[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** 보낸·버린 수(점검·시험용) */
  readonly stats = { sentSpans: 0, sentLogs: 0, dropped: 0, failures: 0, rejected: 0 };

  get enabled() {
    return !!this.cfg;
  }

  span(s: OtlpSpan) {
    if (!this.cfg) return;
    if (this.spans.length >= MAX_QUEUE) return void this.stats.dropped++;
    this.spans.push(s);
    this.schedule();
  }
  log(r: OtlpLogRecord) {
    if (!this.cfg) return;
    if (this.logs.length >= MAX_QUEUE) return void this.stats.dropped++;
    this.logs.push(r);
    this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, Number(process.env.FF_OTLP_FLUSH_MS ?? 5000));
    this.timer.unref?.();
  }

  /** 모아 둔 것을 보낸다 — 실패하면 버리고 센다(재시도하지 않는다: 관측 경로가 기능을 막지 않게) */
  async flush() {
    if (!this.cfg) return;
    const scope = { name: 'ff-platform', version: '1' };
    while (this.spans.length) {
      const batch = this.spans.splice(0, BATCH);
      if (await this.post('/v1/traces', encodeTraces(this.cfg.resource, scope, batch))) this.stats.sentSpans += batch.length;
    }
    while (this.logs.length) {
      const batch = this.logs.splice(0, BATCH);
      if (await this.post('/v1/logs', encodeLogs(this.cfg.resource, scope, batch))) this.stats.sentLogs += batch.length;
    }
  }

  private async post(path: string, body: Uint8Array): Promise<boolean> {
    try {
      const r = await fetch(this.cfg!.base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-protobuf', 'Content-Encoding': 'gzip', ...this.cfg!.headers },
        body: gzipSync(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) {
        this.stats.failures++;
        return false;
      }
      const ps = decodePartialSuccess(new Uint8Array(await r.arrayBuffer()));
      this.stats.rejected += ps.rejected;
      return true;
    } catch {
      this.stats.failures++;
      return false;
    }
  }

  async onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
  }
}
