// 관측(출시 준비 RD-OPS-11) — 외부 의존성 없이:
//   · 상관 ID: X-Correlation-Id(형식 검사, 없거나 이상하면 새로) → 응답 헤더·감사(actorOf가 읽는다)·요청 로그가 같은 값
//   · JSON 로그: 운영 모드 기본(FF_LOG_FORMAT=json|text). 한 줄 = 한 JSON — 로그 수집기가 그대로 읽는다
//   · 요청 로그: 운영 모드 기본(FF_REQUEST_LOG=1|0) — 방법·경로 틀·상태·시간·상관 ID·행위자. 본문·질의 값은 남기지 않는다
//   · 지표: GET /api/health/metrics(Prometheus 텍스트) — 운영 모드는 Authorization: Bearer FF_METRICS_TOKEN, 토큰이 없으면 꺼짐(404)
import type { LoggerService } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { metricDef, METRIC_SERIES_LIMIT, OTHER_LABEL, type TelemetryMetricDef } from '@ff/contracts';
import { isProduction } from './runtime-config';

type Env = Record<string, string | undefined>;

const CORRELATION = /^[A-Za-z0-9._:-]{1,64}$/;

/** 상관 ID — 받은 값이 형식에 맞으면 그대로, 아니면 새로. 요청 헤더에도 다시 넣어 actorOf·감사가 같은 값을 쓴다 */
export function correlation() {
  return (req: Request, res: Response, next: NextFunction) => {
    const got = req.header('x-correlation-id')?.trim() ?? '';
    const id = CORRELATION.test(got) ? got : randomUUID();
    req.headers['x-correlation-id'] = id;
    res.setHeader('X-Correlation-Id', id);
    next();
  };
}

export const logFormat = (env: Env = process.env): 'json' | 'text' => (env.FF_LOG_FORMAT === 'json' || env.FF_LOG_FORMAT === 'text' ? env.FF_LOG_FORMAT : isProduction(env) ? 'json' : 'text');
export const requestLogOn = (env: Env = process.env) => (env.FF_REQUEST_LOG ? env.FF_REQUEST_LOG === '1' : isProduction(env));

/** 한 줄 JSON 로거 — Nest 로거 자리에 넣는다. 오류는 stack을 한 필드로 */
export class JsonLogger implements LoggerService {
  constructor(private readonly write: (line: string) => void = (l) => process.stdout.write(l + '\n')) {}
  private out(level: string, message: unknown, rest: unknown[]) {
    const context = typeof rest.at(-1) === 'string' ? (rest.at(-1) as string) : undefined;
    const stack = rest.find((x) => typeof x === 'string' && x.includes('\n    at ')) as string | undefined;
    const msg = message instanceof Error ? message.message : typeof message === 'string' ? message : JSON.stringify(message);
    this.write(JSON.stringify({ time: new Date().toISOString(), level, msg, ...(context && { context }), ...(message instanceof Error && { stack: message.stack }), ...(stack && { stack }) }));
  }
  /** 구조화된 사건 한 줄(요청 로그 등) — 필드를 그대로 싣는다 */
  event(fields: Record<string, unknown>) {
    this.write(JSON.stringify({ time: new Date().toISOString(), level: 'info', ...fields }));
  }
  log(message: unknown, ...rest: unknown[]) {
    this.out('info', message, rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    this.out('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.out('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.out('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.out('verbose', message, rest);
  }
}

/** 라벨 값 — Prometheus 텍스트 이스케이프, 64자 상한(긴 값이 시계열을 키우지 않게) */
const labelValue = (v: unknown) => String(v ?? '').slice(0, 64).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

type Series = { labels: string[]; value: number; hist?: { buckets: number[]; sum: number; count: number } };

/**
 * 카탈로그(@ff/contracts TELEMETRY_METRICS) 지표 등록부 — 카탈로그에 없는 이름은 받지 않는다(대시보드·경보와 이름이 어긋나지 않게).
 * 지표마다 시계열 수 상한(METRIC_SERIES_LIMIT)을 넘는 새 라벨 조합은 모두 "_other"로 합치고 ff_metrics_series_dropped_total로 센다.
 * gauge는 수집기(onCollect)가 긁을 때마다 다시 채운다.
 */
export class MetricRegistry {
  private readonly series = new Map<string, Map<string, Series>>();
  private readonly collectors: (() => void)[] = [];
  constructor(private readonly limit = METRIC_SERIES_LIMIT) {}

  private def(name: string): TelemetryMetricDef {
    const d = metricDef(name);
    if (!d) throw new Error(`카탈로그에 없는 지표: ${name}`);
    return d;
  }
  private slot(d: TelemetryMetricDef, labels: Record<string, unknown>): Series {
    const fam = this.series.get(d.name) ?? new Map<string, Series>();
    this.series.set(d.name, fam);
    let vals = d.labels.map((l) => labelValue(labels[l]));
    let key = vals.join('\u0001');
    if (!fam.has(key) && fam.size >= this.limit) {
      vals = d.labels.map(() => OTHER_LABEL);
      key = vals.join('\u0001');
      if (d.name !== 'ff_metrics_series_dropped_total') this.inc('ff_metrics_series_dropped_total', { metric: d.name });
    }
    let s = fam.get(key);
    if (!s) {
      s = { labels: vals, value: 0, ...(d.type === 'histogram' ? { hist: { buckets: (d.buckets ?? []).map(() => 0), sum: 0, count: 0 } } : {}) };
      fam.set(key, s);
    }
    return s;
  }
  inc(name: string, labels: Record<string, unknown> = {}, by = 1) {
    const d = this.def(name);
    if (d.type !== 'counter') throw new Error(`${name}은(는) counter가 아니다`);
    if (!(by >= 0)) return;
    this.slot(d, labels).value += by;
  }
  set(name: string, labels: Record<string, unknown>, value: number) {
    const d = this.def(name);
    if (d.type !== 'gauge') throw new Error(`${name}은(는) gauge가 아니다`);
    this.slot(d, labels).value = value;
  }
  observe(name: string, labels: Record<string, unknown>, value: number) {
    const d = this.def(name);
    if (d.type !== 'histogram' || !Number.isFinite(value)) return;
    const h = this.slot(d, labels).hist!;
    // 칸별 개수(누적 아님) — 텍스트로 낼 때 누적한다. 마지막 경계보다 크면 +Inf 칸(count에만)
    const i = (d.buckets ?? []).findIndex((b) => value <= b);
    if (i >= 0) h.buckets[i]++;
    h.sum += value;
    h.count++;
  }
  /** gauge 한 지표의 시계열을 비운다 — 수집기가 다시 채우기 전에(사라진 조합이 남지 않게) */
  clear(name: string) {
    this.series.delete(this.def(name).name);
  }
  onCollect(fn: () => void) {
    this.collectors.push(fn);
  }
  /** 시험·점검용 — 라벨 일부로 값 합 */
  value(name: string, match: Record<string, string> = {}): number {
    const d = this.def(name);
    let n = 0;
    for (const s of this.series.get(name)?.values() ?? []) if (Object.entries(match).every(([k, v]) => s.labels[d.labels.indexOf(k)] === v)) n += s.hist ? s.hist.count : s.value;
    return n;
  }
  text(): string {
    for (const c of this.collectors) {
      try {
        c();
      } catch {
        // 수집기 하나가 실패해도 나머지 지표는 낸다
      }
    }
    const lines: string[] = [];
    for (const [name, fam] of this.series) {
      const d = this.def(name);
      lines.push(`# HELP ${name} ${d.help}`, `# TYPE ${name} ${d.type}`);
      for (const s of fam.values()) {
        const lab = d.labels.map((l, i) => `${l}="${s.labels[i]}"`);
        const base = lab.join(',');
        if (!s.hist) lines.push(`${name}${base ? `{${base}}` : ''} ${s.value}`);
        else {
          const pre = base ? `${base},` : '';
          let cum = 0;
          (d.buckets ?? []).forEach((b, i) => {
            cum += s.hist!.buckets[i];
            lines.push(`${name}_bucket{${pre}le="${b}"} ${cum}`);
          });
          lines.push(`${name}_bucket{${pre}le="+Inf"} ${s.hist.count}`, `${name}_sum${base ? `{${base}}` : ''} ${s.hist.sum.toFixed(6)}`, `${name}_count${base ? `{${base}}` : ''} ${s.hist.count}`);
        }
      }
    }
    return lines.length ? lines.join('\n') + '\n' : '';
  }
}

/** 프로세스 안 지표 — 단일 인스턴스 전제(RD-OPS-14). 경로는 라우트 틀(:id)로 묶어 종류 수를 제한한다 */
export class Metrics {
  private readonly counts = new Map<string, number>();
  private readonly hist = new Map<string, { buckets: number[]; sum: number; count: number }>();
  static readonly BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  private readonly started = Date.now();
  /** 차량 수신·긴급 차단·Flag 평가 등 카탈로그 지표(80-80) */
  readonly registry = new MetricRegistry();

  observe(method: string, route: string, status: number, seconds: number) {
    const k = `method="${method}",route="${route}",status="${status}"`;
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
    const hk = `method="${method}",route="${route}"`;
    const h = this.hist.get(hk) ?? { buckets: Metrics.BUCKETS.map(() => 0), sum: 0, count: 0 };
    Metrics.BUCKETS.forEach((b, i) => seconds <= b && h.buckets[i]++);
    h.sum += seconds;
    h.count++;
    this.hist.set(hk, h);
  }

  text(): string {
    const lines = ['# HELP ff_http_requests_total HTTP 요청 수', '# TYPE ff_http_requests_total counter'];
    for (const [k, v] of this.counts) lines.push(`ff_http_requests_total{${k}} ${v}`);
    lines.push('# HELP ff_http_request_duration_seconds HTTP 처리 시간', '# TYPE ff_http_request_duration_seconds histogram');
    for (const [k, h] of this.hist) {
      Metrics.BUCKETS.forEach((b, i) => lines.push(`ff_http_request_duration_seconds_bucket{${k},le="${b}"} ${h.buckets[i]}`));
      lines.push(`ff_http_request_duration_seconds_bucket{${k},le="+Inf"} ${h.count}`, `ff_http_request_duration_seconds_sum{${k}} ${h.sum.toFixed(6)}`, `ff_http_request_duration_seconds_count{${k}} ${h.count}`);
    }
    const mem = process.memoryUsage();
    lines.push('# TYPE ff_process_uptime_seconds gauge', `ff_process_uptime_seconds ${((Date.now() - this.started) / 1000).toFixed(0)}`);
    lines.push('# TYPE ff_process_resident_memory_bytes gauge', `ff_process_resident_memory_bytes ${mem.rss}`);
    lines.push('# TYPE ff_process_heap_used_bytes gauge', `ff_process_heap_used_bytes ${mem.heapUsed}`);
    return lines.join('\n') + '\n' + this.registry.text();
  }
}

/** 요청마다 지표·요청 로그 — 응답이 끝난 뒤(경로 틀은 라우팅 뒤에야 안다) */
export function requestObserver(metrics: Metrics, log: ((line: Record<string, unknown>) => void) | null) {
  return (req: Request, res: Response, next: NextFunction) => {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
      const route = (req.route?.path as string | undefined) ? `${req.baseUrl ?? ''}${req.route.path}` : req.path.startsWith('/api/') ? 'unmatched' : 'static';
      metrics.observe(req.method, route, res.statusCode, seconds);
      if (log) {
        const actor = (req as Request & { actor?: { id: string; role: string } }).actor;
        log({ type: 'request', method: req.method, route, status: res.statusCode, ms: Math.round(seconds * 1000), correlationId: req.header('x-correlation-id'), ...(actor && { actor: actor.id, role: actor.role }) });
      }
    });
    next();
  };
}

/** 지표 창구 — 운영 모드는 토큰 필수(없으면 꺼짐), 그 밖에는 열림 */
export function metricsEndpoint(metrics: Metrics, env: Env = process.env) {
  return (req: Request, res: Response) => {
    const token = env.FF_METRICS_TOKEN ?? '';
    if (isProduction(env)) {
      if (!token) return void res.status(404).json({ error: { code: 'NOT_FOUND', message: '지표가 꺼져 있습니다(FF_METRICS_TOKEN).' } });
      const got = Buffer.from(req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '');
      const want = Buffer.from(token);
      if (got.length !== want.length || !timingSafeEqual(got, want)) return void res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: '지표 토큰이 맞지 않습니다.' } });
    }
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics.text());
  };
}
