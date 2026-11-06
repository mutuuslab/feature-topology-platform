// OTLP/HTTP protobuf 인코더 (opentelemetry-proto v1 — metrics·logs·traces) — 외부 의존성 없이 필요한 필드만 쓴다(80-80).
// Grafana Cloud OTLP 게이트웨이·Grafana Alloy otlp 수신기가 받는 http/protobuf 본문을 만든다.
// 이 파일은 import·enum·매개변수 속성 없이 둔다 — tools/grafana(Node 타입 스트리핑)가 경로로 바로 읽는다.

export type OtlpValue = string | number | boolean;
export type OtlpAttrs = Record<string, OtlpValue>;

export interface OtlpScope {
  name: string;
  version?: string;
}
export interface OtlpNumberPoint {
  attributes: OtlpAttrs;
  startNs: bigint;
  timeNs: bigint;
  value: number;
}
export interface OtlpHistogramPoint {
  attributes: OtlpAttrs;
  startNs: bigint;
  timeNs: bigint;
  count: number;
  sum: number;
  /** 칸별 개수(누적 아님) — 길이 = bounds.length + 1 */
  bucketCounts: number[];
  bounds: readonly number[];
}
export type OtlpMetric =
  | { name: string; description?: string; kind: 'gauge'; points: OtlpNumberPoint[] }
  | { name: string; description?: string; kind: 'sum'; monotonic: boolean; points: OtlpNumberPoint[] }
  | { name: string; description?: string; kind: 'histogram'; points: OtlpHistogramPoint[] };

export interface OtlpLogRecord {
  timeNs: bigint;
  /** 9 INFO · 13 WARN · 17 ERROR */
  severityNumber: number;
  severityText: string;
  body: string;
  attributes: OtlpAttrs;
  eventName?: string;
  traceId?: string;
  spanId?: string;
}
export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** 1 INTERNAL · 2 SERVER · 3 CLIENT */
  kind: number;
  startNs: bigint;
  endNs: bigint;
  attributes: OtlpAttrs;
  /** 1 OK · 2 ERROR */
  status?: { code: number; message?: string };
}

// ── protobuf 쓰기 ──────────────────────────────────────────
const utf8 = new TextEncoder();

class Writer {
  private chunks: Uint8Array[] = [];
  private size = 0;
  private push(b: Uint8Array) {
    this.chunks.push(b);
    this.size += b.length;
  }
  private varint(v: bigint | number) {
    let n = BigInt(v);
    if (n < 0n) n = BigInt.asUintN(64, n);
    const out: number[] = [];
    while (n > 0x7fn) {
      out.push(Number(n & 0x7fn) | 0x80);
      n >>= 7n;
    }
    out.push(Number(n));
    this.push(Uint8Array.from(out));
  }
  private tag(field: number, wire: number) {
    this.varint((field << 3) | wire);
  }
  uint(field: number, v: number | bigint) {
    if (BigInt(v) === 0n) return this;
    return this.varintField(field, v);
  }
  /** 0이어도 쓰는 varint 필드 */
  varintField(field: number, v: number | bigint) {
    this.tag(field, 0);
    this.varint(v);
    return this;
  }
  bool(field: number, v: boolean) {
    if (!v) return this;
    this.tag(field, 0);
    this.varint(1);
    return this;
  }
  fixed64(field: number, v: bigint | number) {
    this.tag(field, 1);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt.asUintN(64, BigInt(v)), true);
    this.push(b);
    return this;
  }
  double(field: number, v: number) {
    this.tag(field, 1);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    this.push(b);
    return this;
  }
  bytes(field: number, b: Uint8Array) {
    this.tag(field, 2);
    this.varint(b.length);
    this.push(b);
    return this;
  }
  string(field: number, s: string | undefined) {
    if (!s) return this;
    return this.bytes(field, utf8.encode(s));
  }
  message(field: number, w: Writer) {
    return this.bytes(field, w.finish());
  }
  packedFixed64(field: number, xs: readonly (number | bigint)[]) {
    if (!xs.length) return this;
    const b = new Uint8Array(xs.length * 8);
    const dv = new DataView(b.buffer);
    xs.forEach((x, i) => dv.setBigUint64(i * 8, BigInt.asUintN(64, BigInt(x)), true));
    return this.bytes(field, b);
  }
  packedDouble(field: number, xs: readonly number[]) {
    if (!xs.length) return this;
    const b = new Uint8Array(xs.length * 8);
    const dv = new DataView(b.buffer);
    xs.forEach((x, i) => dv.setFloat64(i * 8, x, true));
    return this.bytes(field, b);
  }
  finish(): Uint8Array {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

/** AnyValue — oneof라 0·false·빈 문자열도 값이 있음을 써야 한다(기본값 생략 규칙을 따르지 않는다) */
const anyValue = (v: OtlpValue): Writer => {
  const w = new Writer();
  if (typeof v === 'string') return w.bytes(1, utf8.encode(v));
  if (typeof v === 'boolean') return w.varintField(2, v ? 1 : 0);
  return Number.isInteger(v) && Math.abs(v) < 2 ** 53 ? w.varintField(3, v) : w.double(4, v);
};

const keyValues = (w: Writer, field: number, attrs: OtlpAttrs) => {
  for (const k of Object.keys(attrs).sort()) w.message(field, new Writer().string(1, k).message(2, anyValue(attrs[k])));
  return w;
};
const resourceMsg = (attrs: OtlpAttrs) => keyValues(new Writer(), 1, attrs);
const scopeMsg = (s: OtlpScope) => new Writer().string(1, s.name).string(2, s.version);
const hexBytes = (hex: string, len: number) => {
  if (!new RegExp(`^[0-9a-f]{${len * 2}}$`).test(hex)) throw new Error(`OTLP id 형식: ${hex}`);
  return Uint8Array.from(hex.match(/../g)!.map((x) => parseInt(x, 16)));
};

function numberPoint(p: OtlpNumberPoint): Writer {
  const w = new Writer().fixed64(2, p.startNs).fixed64(3, p.timeNs).double(4, p.value);
  return keyValues(w, 7, p.attributes);
}
function histogramPoint(p: OtlpHistogramPoint): Writer {
  if (p.bucketCounts.length !== p.bounds.length + 1) throw new Error('OTLP histogram: bucketCounts 길이 = bounds + 1');
  const w = new Writer().fixed64(2, p.startNs).fixed64(3, p.timeNs).fixed64(4, p.count).double(5, p.sum).packedFixed64(6, p.bucketCounts).packedDouble(7, p.bounds);
  return keyValues(w, 9, p.attributes);
}

/** ExportMetricsServiceRequest — 누적(CUMULATIVE=2) 합·히스토그램 */
export function encodeMetrics(resource: OtlpAttrs, scope: OtlpScope, metrics: OtlpMetric[]): Uint8Array {
  const sm = new Writer().message(1, scopeMsg(scope));
  for (const m of metrics) {
    const mw = new Writer().string(1, m.name).string(2, m.description);
    if (m.kind === 'gauge') {
      const g = new Writer();
      for (const p of m.points) g.message(1, numberPoint(p));
      mw.message(5, g);
    } else if (m.kind === 'sum') {
      const s = new Writer();
      for (const p of m.points) s.message(1, numberPoint(p));
      s.uint(2, 2).bool(3, m.monotonic);
      mw.message(7, s);
    } else {
      const h = new Writer();
      for (const p of m.points) h.message(1, histogramPoint(p));
      h.uint(2, 2);
      mw.message(9, h);
    }
    sm.message(2, mw);
  }
  const rm = new Writer().message(1, resourceMsg(resource)).message(2, sm);
  return new Writer().message(1, rm).finish();
}

/** ExportLogsServiceRequest */
export function encodeLogs(resource: OtlpAttrs, scope: OtlpScope, records: OtlpLogRecord[]): Uint8Array {
  const sl = new Writer().message(1, scopeMsg(scope));
  for (const r of records) {
    const w = new Writer().fixed64(1, r.timeNs).uint(2, r.severityNumber).string(3, r.severityText).message(5, anyValue(r.body));
    keyValues(w, 6, r.attributes);
    if (r.traceId) w.bytes(9, hexBytes(r.traceId, 16));
    if (r.spanId) w.bytes(10, hexBytes(r.spanId, 8));
    w.fixed64(11, r.timeNs).string(12, r.eventName);
    sl.message(2, w);
  }
  const rl = new Writer().message(1, resourceMsg(resource)).message(2, sl);
  return new Writer().message(1, rl).finish();
}

/** ExportTraceServiceRequest */
export function encodeTraces(resource: OtlpAttrs, scope: OtlpScope, spans: OtlpSpan[]): Uint8Array {
  const ss = new Writer().message(1, scopeMsg(scope));
  for (const s of spans) {
    const w = new Writer().bytes(1, hexBytes(s.traceId, 16)).bytes(2, hexBytes(s.spanId, 8));
    if (s.parentSpanId) w.bytes(4, hexBytes(s.parentSpanId, 8));
    w.string(5, s.name).uint(6, s.kind).fixed64(7, s.startNs).fixed64(8, s.endNs);
    keyValues(w, 9, s.attributes);
    if (s.status) w.message(15, new Writer().string(2, s.status.message).uint(3, s.status.code));
    ss.message(2, w);
  }
  const rs = new Writer().message(1, resourceMsg(resource)).message(2, ss);
  return new Writer().message(1, rs).finish();
}

// ── protobuf 읽기(응답 partial_success·시험) ───────────────────
export interface ProtoField {
  field: number;
  wire: number;
  /** varint·fixed는 bigint, length-delimited는 바이트 */
  value: bigint | Uint8Array;
}
export function decodeFields(b: Uint8Array): ProtoField[] {
  const out: ProtoField[] = [];
  let i = 0;
  const varint = () => {
    let shift = 0n;
    let v = 0n;
    for (;;) {
      if (i >= b.length) throw new Error('protobuf: varint가 끝나지 않았다');
      const x = b[i++];
      v |= BigInt(x & 0x7f) << shift;
      if (!(x & 0x80)) return v;
      shift += 7n;
    }
  };
  while (i < b.length) {
    const key = Number(varint());
    const field = key >> 3;
    const wire = key & 7;
    if (wire === 0) out.push({ field, wire, value: varint() });
    else if (wire === 1) {
      out.push({ field, wire, value: new DataView(b.buffer, b.byteOffset + i, 8).getBigUint64(0, true) });
      i += 8;
    } else if (wire === 2) {
      const len = Number(varint());
      if (i + len > b.length) throw new Error('protobuf: 길이가 본문을 넘는다');
      out.push({ field, wire, value: b.subarray(i, i + len) });
      i += len;
    } else if (wire === 5) {
      out.push({ field, wire, value: BigInt(new DataView(b.buffer, b.byteOffset + i, 4).getUint32(0, true)) });
      i += 4;
    } else throw new Error(`protobuf: 모르는 wire ${wire}`);
  }
  return out;
}
export const fieldBytes = (fs: ProtoField[], n: number) => fs.filter((f) => f.field === n).map((f) => f.value as Uint8Array);
export const fieldString = (fs: ProtoField[], n: number) => {
  const f = fs.find((x) => x.field === n);
  return f ? new TextDecoder().decode(f.value as Uint8Array) : '';
};
export const fixedDouble = (v: bigint) => {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setBigUint64(0, v, true);
  return dv.getFloat64(0, true);
};

/** Export*ServiceResponse.partial_success — {rejected, message}. 비었으면 전부 받아들임 */
export function decodePartialSuccess(b: Uint8Array): { rejected: number; message: string } {
  const ps = fieldBytes(decodeFields(b), 1)[0];
  if (!ps) return { rejected: 0, message: '' };
  const f = decodeFields(ps);
  const rej = f.find((x) => x.field === 1);
  return { rejected: rej ? Number(rej.value as bigint) : 0, message: fieldString(f, 2) };
}

/** ISO 시각·ms → 나노초 */
export const nanos = (ms: number): bigint => BigInt(Math.round(ms)) * 1_000_000n;
