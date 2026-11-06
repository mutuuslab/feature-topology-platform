// 결정적 시연 시계열(80-80) — FF 시연 데이터(demo-catalog.json)와 같은 Feature·Flag·정책·국가·차종·SW로,
// '지금' 기준 시각의 지표·로그·추적을 만든다. 같은 시각이면 언제 다시 만들어도 같은 값이다(15분마다 다시 보내도 겹친 점이 같다).
// 패턴: 국가별 현지 시각의 주행(출퇴근 정점·주말 늦은 정점), 통신 지연 분포(로그정규), 칸별 간헐 장애, 14일 주기 Canary 단계 확대,
// 하루 1~2회 긴급 차단 사건(등급별 반영 지연·기한 초과·재전송·복원), Edge 장애·Unleash drift 창, Feature별 개선 신호.
// 누적 지표는 UTC 자정에 0부터 다시 센다(OTLP start_time = 자정).
import { APPLY_LATENCY_BUCKETS, HEALTH_INDICATORS, HTTP_BUCKETS, metricDef, SIGNATURE_REJECT_REASONS } from '../../contracts/src/rules/telemetry-metrics.ts';
import type { OtlpAttrs, OtlpHistogramPoint, OtlpLogRecord, OtlpMetric, OtlpNumberPoint, OtlpSpan } from '../../backend/src/kernel/otlp/otlp-proto.ts';
import type { DemoCatalog } from './demo-catalog.ts';

const MIN = 60_000;
const DAY = 86_400_000;
const NS = 1_000_000n;

// ── 결정적 난수 ─────────────────────────────────────────────
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/** 열쇠들로 정해지는 [0,1) */
export function rand(...keys: (string | number)[]): number {
  let t = (hash(keys.join('|')) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const gauss = (x: number, mu: number, sd: number) => Math.exp(-((x - mu) ** 2) / (2 * sd * sd));
/** 기댓값 x를 정수로 — 소수부는 결정적 확률로 올림 */
const draw = (x: number, ...keys: (string | number)[]) => (x <= 0 ? 0 : Math.floor(x) + (rand(...keys) < x - Math.floor(x) ? 1 : 0));
/** 로그정규 표본(중앙값 median, 퍼짐 sigma) */
const lognormal = (median: number, sigma: number, ...keys: (string | number)[]) => {
  const u1 = Math.max(1e-9, rand(...keys, 'a'));
  const u2 = rand(...keys, 'b');
  return median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
};

// ── 시간 모양 ───────────────────────────────────────────────
/** 시장별 UTC 시차(시) — 11월 기준(EU CET, US EST) */
export const UTC_OFFSET: Record<string, number> = { KR: 9, EU: 1, US: -5, AU: 11 };
const dayIndex = (ms: number) => Math.floor(ms / DAY);
export const dayStart = (ms: number) => dayIndex(ms) * DAY;

/** 주행 중 차량 비율(0~1) — 현지 시각 출퇴근 정점, 주말은 늦고 완만 */
export function activity(country: string, ms: number): number {
  const local = ms + (UTC_OFFSET[country] ?? 0) * 3_600_000;
  const h = (local % DAY) / 3_600_000;
  const dow = (Math.floor(local / DAY) + 4) % 7; // 0=일
  const weekend = dow === 0 || dow === 6;
  const base = weekend ? 0.04 + 0.42 * gauss(h, 14, 3.5) + 0.16 * gauss(h, 20, 2) : 0.04 + 0.55 * gauss(h, 8, 1.2) + 0.45 * gauss(h, 18.2, 1.5) + 0.22 * gauss(h, 13, 2.8);
  const jitter = 0.92 + 0.16 * rand('act', country, dayIndex(local));
  return Math.min(0.9, Math.max(0.02, base * jitter));
}

/** 칸별 간헐 장애 — 하루 25% 확률로 15~45분, 수신 70~95% 감소·지연 증가 */
export function outage(cell: string, ms: number): { drop: number; slow: number } {
  const d = dayIndex(ms);
  for (const day of [d, d - 1]) {
    if (rand('outage', cell, day) > 0.25) continue;
    const start = day * DAY + rand('outage-at', cell, day) * DAY;
    const len = (15 + rand('outage-len', cell, day) * 30) * MIN;
    if (ms >= start && ms < start + len) return { drop: 0.7 + 0.25 * rand('outage-sev', cell, day), slow: 6 };
  }
  return { drop: 0, slow: 1 };
}

/** 주 1회 Edge 장애 창(목 01:00 UTC부터 30분) — 오류율·지연 증가 */
const edgeIncident = (ms: number) => {
  const dow = (dayIndex(ms) + 4) % 7;
  const h = (ms % DAY) / 3_600_000;
  return dow === 4 && h >= 1 && h < 1.5;
};
/** 주 1회 Unleash drift 창(목 02:00~02:40 UTC, 한 Flag) */
const driftWindow = (ms: number) => {
  const dow = (dayIndex(ms) + 4) % 7;
  const h = (ms % DAY) / 3_600_000;
  return dow === 4 && h >= 2 && h < 2 + 40 / 60;
};
/** 사흘에 한 번 꼴 서명 위조 시도(한 칸, 20분) */
const signatureAttack = (cell: string, ms: number) => {
  const d = dayIndex(ms);
  if (rand('sigatk', cell, d) > 0.12) return false;
  const start = d * DAY + rand('sigatk-at', cell, d) * DAY;
  return ms >= start && ms < start + 20 * MIN;
};

// ── 시연 모집단 ─────────────────────────────────────────────
interface Cell {
  key: string;
  country: string;
  model: string;
  sw: string;
  vehicles: number;
}
interface FeatureVersion {
  featureId: string;
  version: string;
  name: string;
  country: string;
  model: string;
  cohort: 'treatment' | 'control' | 'fleet';
  /** 이 Version을 쓰는 차량 비율(칸 안) */
  share: (ms: number) => number;
  eligible: number;
  adoption: number;
  offRate: number;
  quickRate: number;
  fallbackRate: (ms: number, model: string) => number;
  errorRate: number;
  dtcRate: (ms: number) => number;
}
interface Incident {
  id: string;
  featureId: string;
  country: string;
  model: string;
  dc: string;
  issued: number;
  released: number;
  targets: number;
}

/** 14일 주기 Canary — 5% → 25% → 50% → 100% (사흘·사흘·사흘·닷새) */
export function canaryStage(ms: number): number {
  const d = ((dayIndex(ms) % 14) + 14) % 14;
  return d < 3 ? 0.05 : d < 6 ? 0.25 : d < 9 ? 0.5 : 1;
}
const CANARY_FEATURE = 'FEAT-00005';

/** Feature별 개선 신호(시연 시나리오) — 대시보드·경보가 '개선 후보'로 잡는 것 */
const SIGNALS: Record<string, Partial<{ adoption: number; offRate: number; quickRate: number; errorX: number; fallbackModel: string }>> = {
  'FEAT-00024': { adoption: 0.17 }, // 사용률 저조 — IC·JC 경로 사전안내
  'FEAT-00026': { offRate: 0.21 }, // 운전자가 자주 끔 — 급가속 억제(EU)
  'FEAT-00027': { quickRate: 0.13 }, // 켜고 바로 끔(이탈) — 상세 안내(EU)
  'FEAT-00002@1.6.0': { errorX: 2.6 }, // 출시 후 오류 증가 — 1.5.0 대비
  'FEAT-00004@4.1.0': { fallbackModel: 'GN7' }, // 특정 차종에서 폴백 급증
};

export class DemoModel {
  readonly cells: Cell[];
  readonly versions: FeatureVersion[];
  readonly catalog: DemoCatalog;
  constructor(catalog: DemoCatalog) {
    this.catalog = catalog;
    this.cells = catalog.fleet.map((c) => ({ key: `${c.country}|${c.vehicleModel}|${c.swVersion}`, country: c.country, model: c.vehicleModel, sw: c.swVersion, vehicles: c.vehicles }));
    this.versions = [];
    for (const f of catalog.features) {
      const eligible = this.cells.filter((c) => c.country === f.country && c.model === f.vehicleModel).reduce((n, c) => n + c.vehicles, 0);
      if (!eligible) continue; // 차량이 없는 시장(AU)은 보내지 않는다
      const canary = f.featureId === CANARY_FEATURE && !!f.previous;
      const sig = { ...SIGNALS[f.featureId], ...SIGNALS[`${f.featureId}@${f.version}`] };
      const make = (version: string, latest: boolean): FeatureVersion => {
        const sigV = latest ? sig : { ...SIGNALS[f.featureId] };
        const baseShare = f.previous ? 0.7 : 1;
        return {
          featureId: f.featureId,
          version,
          name: f.name,
          country: f.country,
          model: f.vehicleModel,
          cohort: canary ? (latest ? 'treatment' : 'control') : 'fleet',
          share: canary ? (ms) => (latest ? canaryStage(ms) : 1 - canaryStage(ms)) : () => (latest ? baseShare : 1 - baseShare),
          eligible,
          adoption: sigV.adoption ?? 0.55 + 0.35 * rand('adopt', f.featureId),
          offRate: sigV.offRate ?? 0.025 + 0.05 * rand('off', f.featureId),
          quickRate: sigV.quickRate ?? 0.012 + 0.015 * rand('quick', f.featureId),
          fallbackRate: (ms, model) => (sigV.fallbackModel === model && ((dayIndex(ms) % 14) + 14) % 14 >= 3 ? 0.085 : 0.004 + 0.004 * rand('fb', f.featureId)),
          errorRate: 0.0006 * (sigV.errorX ?? 1) * (0.8 + 0.4 * rand('err', f.featureId)),
          dtcRate: (ms) => 0.00025 * (canary && latest && ((dayIndex(ms) % 14) + 14) % 14 >= 6 ? 1.9 : 1),
        };
      };
      this.versions.push(make(f.version, true));
      if (f.previous) this.versions.push(make(f.previous, false));
    }
  }

  /** 칸의 Feature(차량이 받는 Feature) — 없으면 '-' */
  featuresOf(c: Cell): string[] {
    const ids = [...new Set(this.versions.filter((v) => v.country === c.country && v.model === c.model).map((v) => v.featureId))];
    return ids.length ? ids : ['-'];
  }
  /** 배포된 Flag가 닿는 칸 */
  flagCells(featureId: string) {
    const f = this.catalog.features.find((x) => x.featureId === featureId);
    return f ? this.cells.filter((c) => c.country === f.country && c.model === f.vehicleModel) : [];
  }

  /** 그날의 긴급 차단 사건 1~2건 — FF 시연 차단(Feature·등급)을 첫 사건으로 쓴다 */
  incidents(day: number): Incident[] {
    const pool = [...this.catalog.kills.map((k) => ({ featureId: k.featureId, dc: k.deactClass })), { featureId: 'FEAT-00023', dc: 'DC1' }, { featureId: 'FEAT-00026', dc: 'DC0' }, { featureId: 'FEAT-00022', dc: 'DC2' }];
    const n = rand('inc-n', day) < 0.55 ? 1 : 2;
    const out: Incident[] = [];
    for (let i = 0; i < n; i++) {
      const pick = i === 0 && rand('inc-first', day) < 0.5 ? pool[0] : pool[Math.floor(rand('inc-pick', day, i) * pool.length)];
      const f = this.catalog.features.find((x) => x.featureId === pick.featureId);
      if (!f) continue;
      const cells = this.flagCells(f.featureId);
      const fleet = cells.reduce((s, c) => s + c.vehicles, 0);
      if (!fleet) continue;
      // 현지 업무 시간(09~18시)에 발령
      const localHour = 9 + rand('inc-h', day, i) * 9;
      const issued = day * DAY + (localHour - (UTC_OFFSET[f.country] ?? 0)) * 3_600_000;
      out.push({ id: `INC-${day}-${i}`, featureId: f.featureId, country: f.country, model: f.vehicleModel, dc: pick.dc, issued, released: issued + (2 + 3 * rand('inc-len', day, i)) * 3_600_000, targets: Math.max(1, Math.round(fleet * (0.2 + 0.8 * rand('inc-share', day, i)))) });
    }
    return out;
  }
  /** 사건 차량 한 대가 끝 상태를 보고하기까지(초) — 등급별 */
  applySeconds(inc: Incident, v: number): number {
    const offline = rand('inc-off', inc.id, v) < 0.03;
    const base = inc.dc === 'DC0' ? lognormal(6, 0.6, inc.id, v) : inc.dc === 'DC1' ? lognormal(90, 0.8, inc.id, v) : inc.dc === 'DC2' ? lognormal(240, 0.7, inc.id, v) : lognormal(4 * 3600, 0.6, inc.id, v);
    return offline ? base + 3600 * (1 + 5 * rand('inc-off-h', inc.id, v)) : base;
  }
  static readonly DUE: Record<string, number> = { DC0: 60, DC1: 600, DC2: 1800, DC3: 6 * 3600 };

  /** 하루 정책 배포 2~3회(KR 업무 시간) — 배포 Flag 중 하나 */
  deployments(day: number) {
    const flags = this.catalog.policies.filter((p) => p.status === 'DEPLOYED');
    const n = 2 + (rand('dep-n', day) < 0.5 ? 1 : 0);
    return Array.from({ length: n }, (_, i) => {
      const p = flags[Math.floor(rand('dep-f', day, i) * flags.length)];
      return { id: `DEP-${day}-${i}`, policy: p, at: day * DAY + (10 + 7 * rand('dep-h', day, i) - 9) * 3_600_000 };
    }).filter((d) => !!d.policy);
  }
}

// ── 누적 ────────────────────────────────────────────────────
type Labels = Record<string, string | number>;
class Acc {
  readonly counters = new Map<string, Map<string, { labels: Labels; value: number }>>();
  readonly hists = new Map<string, Map<string, { labels: Labels; buckets: number[]; sum: number; count: number }>>();
  private key(name: string, labels: Labels) {
    const d = metricDef(name);
    if (!d) throw new Error(`카탈로그에 없는 지표: ${name}`);
    for (const k of Object.keys(labels)) if (!d.labels.includes(k)) throw new Error(`${name}에 없는 라벨: ${k}`);
    return { d, k: d.labels.map((l) => String(labels[l] ?? '')).join('\u0001') };
  }
  inc(name: string, labels: Labels, by: number) {
    if (by <= 0) return;
    const { d, k } = this.key(name, labels);
    if (d.type !== 'counter') throw new Error(`${name}은 counter가 아니다`);
    const fam = this.counters.get(name) ?? new Map();
    this.counters.set(name, fam);
    const s = fam.get(k) ?? { labels: Object.fromEntries(d.labels.map((l) => [l, String(labels[l] ?? '')])), value: 0 };
    s.value += by;
    fam.set(k, s);
  }
  observe(name: string, labels: Labels, value: number, n = 1) {
    if (n <= 0) return;
    const { d, k } = this.key(name, labels);
    if (d.type !== 'histogram') throw new Error(`${name}은 histogram이 아니다`);
    const fam = this.hists.get(name) ?? new Map();
    this.hists.set(name, fam);
    const b = d.buckets ?? [];
    const s = fam.get(k) ?? { labels: Object.fromEntries(d.labels.map((l) => [l, String(labels[l] ?? '')])), buckets: new Array(b.length + 1).fill(0), sum: 0, count: 0 };
    const i = b.findIndex((x) => value <= x);
    s.buckets[i < 0 ? b.length : i] += n;
    s.sum += value * n;
    s.count += n;
    fam.set(k, s);
  }
  clone(): Acc {
    const a = new Acc();
    for (const [n, fam] of this.counters) a.counters.set(n, new Map([...fam].map(([k, s]) => [k, { labels: s.labels, value: s.value }])));
    for (const [n, fam] of this.hists) a.hists.set(n, new Map([...fam].map(([k, s]) => [k, { labels: s.labels, buckets: [...s.buckets], sum: s.sum, count: s.count }])));
    return a;
  }
}

export interface DemoEvents {
  logs: OtlpLogRecord[];
  spans: OtlpSpan[];
}
const SOURCE_OF = (name: string) => metricDef(name)?.source ?? 'platform';
const LOG_PER_MIN = 40;

/** 한 분 동안의 증가분(누적기에 더한다) — events가 있으면 그 분의 로그·추적도 만든다 */
function minute(model: DemoModel, m: number, acc: Acc, ev: DemoEvents | null) {
  const t = m * MIN;
  const day = dayIndex(t);
  const logs: OtlpLogRecord[] = [];
  const log = (name: string, sev: number, attrs: OtlpAttrs, at = t) => ev && logs.length < LOG_PER_MIN && logs.push({ timeNs: BigInt(Math.round(at)) * NS, severityNumber: sev, severityText: sev >= 17 ? 'ERROR' : sev >= 13 ? 'WARN' : 'INFO', body: name, eventName: name, attributes: { event: name, ...attrs } });
  const spanId = (...k: (string | number)[]) => hash(k.join('|') + 's1').toString(16).padStart(8, '0') + hash(k.join('|') + 's2').toString(16).padStart(8, '0');
  const traceId = (...k: (string | number)[]) => spanId(...k, 't1') + spanId(...k, 't2');

  // 차량 상태 보고·회신 배경 트래픽
  for (const c of model.cells) {
    const a = activity(c.country, t);
    const o = outage(c.key, t);
    const feats = model.featuresOf(c);
    const reports = draw(c.vehicles * (a * 0.1 + 0.008) * (1 - o.drop), 'rep', c.key, m);
    const attack = signatureAttack(c.key, t);
    for (let i = 0; i < reports; i++) {
      const feature = feats[Math.floor(rand('rep-f', c.key, m, i) * feats.length)];
      const via = c.country === 'KR' && rand('via', c.key, m, i) < 0.15 ? 'GLEO' : 'IF-06';
      const r = rand('rep-r', c.key, m, i);
      const rejectP = attack ? 0.05 : 0.003;
      if (r < rejectP) {
        const codes = attack ? ['AUTH_FAILED'] : ['REPLAY', 'REPLAY', 'REPLAY', 'SCHEMA', 'PSEUDONYM_MISMATCH', 'AUTH_FAILED'];
        const code = codes[Math.floor(rand('rep-c', c.key, m, i) * codes.length)];
        acc.inc('ff_vehicle_status_reports_total', { country: c.country, vehicle_model: c.model, sw_version: c.sw, feature, via, result: 'rejected', code }, 1);
        if (code !== 'SCHEMA') acc.inc('ff_vehicle_status_auth_total', { country: c.country, vehicle_model: c.model, result: code === 'AUTH_FAILED' ? 'invalid' : 'valid' }, 1);
        log('vehicle.status.rejected', 13, { country: c.country, vehicle_model: c.model, feature, step: code === 'AUTH_FAILED' ? 'AUTH' : code === 'SCHEMA' ? 'SCHEMA' : code === 'REPLAY' ? 'SEQUENCE' : 'TARGET', code }, t + rand('rep-t', c.key, m, i) * MIN);
      } else {
        acc.inc('ff_vehicle_status_reports_total', { country: c.country, vehicle_model: c.model, sw_version: c.sw, feature, via, result: 'accepted', code: '' }, 1);
        acc.inc('ff_vehicle_status_auth_total', { country: c.country, vehicle_model: c.model, result: 'valid' }, 1);
        const dtc = rand('dtc', c.key, m, i) < 0.005;
        if (dtc) acc.inc('ff_vehicle_dtc_reports_total', { country: c.country, vehicle_model: c.model, feature }, 1);
        // 수신 로그는 표본(7건에 1건 꼴)·DTC 보고는 모두
        if (dtc || rand('rep-log', c.key, m, i) < 0.15) log('vehicle.status.accepted', dtc ? 13 : 9, { country: c.country, vehicle_model: c.model, sw_version: c.sw, feature, via, dtc: dtc ? 1 : 0 }, t + rand('rep-t', c.key, m, i) * MIN);
      }
    }
  }

  // 정책 배포 → 게시본 전달·회신
  for (const dep of model.deployments(day)) {
    const cells = model.flagCells(dep.policy.featureId);
    if (m === Math.floor(dep.at / MIN)) {
      acc.inc('ff_events_total', { type: 'policy.deployed' }, 1);
      acc.inc('ff_events_total', { type: 'publication.signed' }, 1);
      const targets = cells.reduce((n, c) => n + c.vehicles, 0);
      const unreachable = Math.round(targets * (0.01 + 0.02 * rand('dep-u', dep.id)));
      acc.inc('ff_publication_deliveries_total', { kind: 'POLICY', channel: 'ota' }, Math.round((targets - unreachable) * 0.9));
      acc.inc('ff_publication_deliveries_total', { kind: 'POLICY', channel: 'gleo' }, targets - unreachable - Math.round((targets - unreachable) * 0.9));
      acc.inc('ff_publication_deliveries_total', { kind: 'POLICY', channel: 'unreachable' }, unreachable);
      log('policy.deployed', 9, { policy: dep.policy.policyId, flag: dep.policy.flagKey, feature: dep.policy.featureId, target_vehicles: targets });
      if (ev) {
        const root = { traceId: traceId(dep.id), spanId: spanId(dep.id, 'root') };
        ev.spans.push({ ...root, name: 'publication.dispatch', kind: 2, startNs: BigInt(Math.round(dep.at)) * NS, endNs: BigInt(Math.round(dep.at + 1800)) * NS, attributes: { 'ff.policy': dep.policy.policyId, 'feature_flag.key': dep.policy.flagKey, 'ff.feature': dep.policy.featureId, 'ff.kind': 'POLICY', 'ff.targets': targets } });
        for (let v = 0; v < Math.min(20, targets); v++) {
          const cell = cells[v % cells.length];
          const lat = lognormal(25, 0.9, dep.id, v) * outage(cell.key, dep.at).slow;
          ev.spans.push({ traceId: root.traceId, spanId: spanId(dep.id, v), parentSpanId: root.spanId, name: 'vehicle.readback', kind: 1, startNs: BigInt(Math.round(dep.at)) * NS, endNs: BigInt(Math.round(dep.at + lat * 1000)) * NS, attributes: { 'ff.country': cell.country, 'ff.vehicle_model': cell.model, 'ff.feature': dep.policy.featureId, 'ff.kind': 'POLICY', 'ff.result': 'applied' } });
        }
      }
    }
    // 회신 — 게시 뒤 2시간 안에 지연 분포대로
    if (t >= dep.at && t < dep.at + 2 * 3_600_000) {
      for (const c of cells) {
        for (let v = 0; v < c.vehicles; v++) {
          const lat = lognormal(25, 0.9, dep.id, c.key, v) * outage(c.key, dep.at).slow + (rand('dep-off', dep.id, c.key, v) < 0.04 ? 1800 + 3600 * rand('dep-offh', dep.id, c.key, v) : 0);
          const at = dep.at + lat * 1000;
          if (Math.floor(at / MIN) !== m) continue;
          const rr = rand('rb', dep.id, c.key, v);
          const sigAttack = signatureAttack(c.key, at);
          const reason = sigAttack && rr < 0.2 ? 'SIGNATURE_INVALID' : rr < 0.002 ? 'REPLAY' : rr < 0.0026 ? 'TARGET_MISMATCH' : rr < 0.0029 ? 'SIGNATURE_INVALID' : '';
          acc.inc('ff_vehicle_readbacks_total', { country: c.country, vehicle_model: c.model, sw_version: c.sw, feature: dep.policy.featureId, kind: 'POLICY', via: 'IF-06', result: reason ? 'rejected' : 'applied', reason }, 1);
          acc.inc('ff_vehicle_signature_checks_total', { country: c.country, vehicle_model: c.model, kind: 'POLICY', result: (SIGNATURE_REJECT_REASONS as readonly string[]).includes(reason) ? 'invalid' : 'valid' }, 1);
          acc.observe('ff_vehicle_readback_latency_seconds', { kind: 'POLICY', country: c.country }, lat);
          if (v % 7 === 0 || reason) log('vehicle.readback', reason ? 13 : 9, { country: c.country, vehicle_model: c.model, sw_version: c.sw, feature: dep.policy.featureId, publication_id: dep.id.replace('DEP', 'PUB'), kind: 'POLICY', result: reason ? 'rejected' : 'applied', reason, latency_ms: Math.round(lat * 1000) }, at);
        }
      }
    }
  }

  // 긴급 차단 사건(전날 것이 이어질 수 있다)
  for (const inc of [...model.incidents(day - 1), ...model.incidents(day)]) {
    const due = DemoModel.DUE[inc.dc] ?? 1800;
    if (m === Math.floor(inc.issued / MIN)) {
      acc.inc('ff_kill_commands_total', { feature: inc.featureId, deact_class: inc.dc }, 1);
      acc.inc('ff_events_total', { type: 'kill.issued' }, 1);
      log('kill.issued', 13, { feature: inc.featureId, deact_class: inc.dc, kill_id: inc.id.replace('INC', 'KILL'), target_vehicles: inc.targets }, inc.issued);
      if (ev) ev.spans.push({ traceId: traceId(inc.id), spanId: spanId(inc.id, 'root'), name: 'kill.dispatch', kind: 2, startNs: BigInt(Math.round(inc.issued)) * NS, endNs: BigInt(Math.round(inc.issued + 2500)) * NS, attributes: { 'ff.feature': inc.featureId, 'ff.deact_class': inc.dc, 'ff.targets': inc.targets } });
    }
    if (m === Math.floor((inc.issued + due * 1000) / MIN)) {
      const late = Array.from({ length: inc.targets }, (_, v) => model.applySeconds(inc, v)).filter((s) => s > due).length;
      if (late) {
        acc.inc('ff_kill_overdue_vehicles_total', { feature: inc.featureId, deact_class: inc.dc }, late);
        acc.inc('ff_events_total', { type: 'kill.overdue' }, 1);
        log('kill.overdue', 17, { feature: inc.featureId, kill_id: inc.id.replace('INC', 'KILL'), overdue_vehicles: late });
      }
    }
    if (m === Math.floor(inc.released / MIN)) {
      acc.inc('ff_kill_releases_total', { feature: inc.featureId }, 1);
      acc.inc('ff_events_total', { type: 'kill.released' }, 1);
      log('kill.released', 9, { feature: inc.featureId, kill_id: inc.id.replace('INC', 'KILL') }, inc.released);
    }
    for (let v = 0; v < inc.targets; v++) {
      const s = model.applySeconds(inc, v);
      const cell = model.flagCells(inc.featureId)[v % model.flagCells(inc.featureId).length];
      if (Math.floor((inc.issued + s * 1000) / MIN) === m) {
        acc.observe('ff_kill_apply_latency_seconds', { feature: inc.featureId, deact_class: inc.dc, request: 'deactivate' }, s);
        acc.inc('ff_vehicle_readbacks_total', { country: cell.country, vehicle_model: cell.model, sw_version: cell.sw, feature: inc.featureId, kind: 'KILL', via: 'IF-06', result: 'applied', reason: '' }, 1);
        acc.inc('ff_vehicle_signature_checks_total', { country: cell.country, vehicle_model: cell.model, kind: 'KILL', result: 'valid' }, 1);
        acc.observe('ff_vehicle_readback_latency_seconds', { kind: 'KILL', country: cell.country }, s);
        log('kill.applied', 9, { country: cell.country, vehicle_model: cell.model, feature: inc.featureId, kill_id: inc.id.replace('INC', 'KILL'), request: 'deactivate', latency_ms: Math.round(s * 1000) }, inc.issued + s * 1000);
        if (ev && v < 15) ev.spans.push({ traceId: traceId(inc.id), spanId: spanId(inc.id, v), parentSpanId: spanId(inc.id, 'root'), name: 'vehicle.kill.apply', kind: 1, startNs: BigInt(Math.round(inc.issued)) * NS, endNs: BigInt(Math.round(inc.issued + s * 1000)) * NS, attributes: { 'ff.country': cell.country, 'ff.vehicle_model': cell.model, 'ff.feature': inc.featureId, 'ff.deact_class': inc.dc } });
      }
      if (s > 2 * (DemoModel.DUE[inc.dc] ?? 1800) / 3 && Math.floor((inc.issued + 5 * MIN) / MIN) === m) acc.inc('ff_kill_reissues_total', { feature: inc.featureId }, 1);
      const rs = lognormal(40, 0.8, inc.id, 'restore', v);
      if (Math.floor((inc.released + rs * 1000) / MIN) === m) {
        acc.observe('ff_kill_apply_latency_seconds', { feature: inc.featureId, deact_class: inc.dc, request: 'restore' }, rs);
        acc.inc('ff_vehicle_readbacks_total', { country: cell.country, vehicle_model: cell.model, sw_version: cell.sw, feature: inc.featureId, kind: 'RESTORE', via: 'IF-06', result: 'applied', reason: '' }, 1);
        acc.inc('ff_vehicle_signature_checks_total', { country: cell.country, vehicle_model: cell.model, kind: 'RESTORE', result: 'valid' }, 1);
        acc.observe('ff_vehicle_readback_latency_seconds', { kind: 'RESTORE', country: cell.country }, rs);
      }
    }
  }
  const killed = new Set([...model.incidents(day - 1), ...model.incidents(day)].filter((i) => t >= i.issued && t < i.released).map((i) => i.featureId));

  // Flag 평가(OFREP) — F2 이상은 안전 경계(DISABLED·safe_default)
  const edgeBad = edgeIncident(t);
  let edgeCalls = 0;
  for (const p of model.catalog.policies) {
    const exp = model.catalog.experiments.find((e) => e.flagKey === p.flagKey && e.status === 'RUNNING');
    if (p.status !== 'DEPLOYED' && !exp) continue;
    for (const c of model.flagCells(p.featureId)) {
      const evals = draw(c.vehicles * activity(c.country, t) * 1.6, 'ev', p.flagKey, c.key, m);
      edgeCalls += evals;
      const tally = new Map<string, number>();
      for (let i = 0; i < evals; i++) {
        const r = rand('ev-r', p.flagKey, c.key, m, i);
        const guarded = p.fClass === 'F2' || p.fClass === 'F3' || p.fClass === 'F4';
        const errP = edgeBad ? 0.02 : 0.0015;
        let reason: string;
        let variant: string;
        if (guarded) [reason, variant] = ['DISABLED', 'safe_default'];
        else if (killed.has(p.featureId)) [reason, variant] = ['DISABLED', 'off'];
        else if (r < errP) [reason, variant] = ['ERROR', ''];
        else if (exp) [reason, variant] = r < exp.treatmentRatio ? ['SPLIT', 'treatment'] : ['SPLIT', 'control'];
        else if (r < 0.06) [reason, variant] = ['DEFAULT', 'off'];
        else [reason, variant] = ['TARGETING_MATCH', 'on'];
        const k = `${reason}|${variant}`;
        tally.set(k, (tally.get(k) ?? 0) + 1);
        if (reason === 'ERROR') acc.inc('ff_flag_evaluation_errors_total', { flag: p.flagKey, error: edgeBad || rand('ev-e', p.flagKey, m, i) < 0.6 ? 'general' : 'flag_not_found' }, 1);
        if (ev && i < 2 && rand('ev-s', p.flagKey, c.key, m) < 0.25) {
          const at = t + rand('ev-at', p.flagKey, c.key, m, i) * MIN;
          ev.spans.push({ traceId: traceId('ev', p.flagKey, c.key, m, i), spanId: spanId('ev', p.flagKey, c.key, m, i), name: 'feature_flag.evaluation', kind: 2, startNs: BigInt(Math.round(at)) * NS, endNs: BigInt(Math.round(at + lognormal(9, 0.5, 'ev-d', p.flagKey, m, i) * (edgeBad ? 8 : 1))) * NS, attributes: { 'feature_flag.key': p.flagKey, 'feature_flag.provider.name': 'ffp-ofrep', 'feature_flag.result.reason': reason.toLowerCase(), ...(variant && { 'feature_flag.result.variant': variant }), 'ffp.f_class': p.fClass, 'ff.feature': p.featureId, 'ff.country': c.country }, ...(reason === 'ERROR' && { status: { code: 2, message: 'general' } }) });
        }
      }
      for (const [k, n] of tally) {
        const [reason, variant] = k.split('|');
        acc.inc('ff_flag_evaluations_total', { flag: p.flagKey, feature: p.featureId, reason, variant, provider: 'ffp-ofrep' }, n);
      }
    }
  }
  // Edge 호출 — 평가 호출 일부 + 정의 캐시 갱신
  const edgeN = Math.max(2, Math.round(edgeCalls * 0.3));
  for (let i = 0; i < edgeN; i++) {
    const fail = rand('edge-f', m, i) < (edgeBad ? 0.05 : 0.0008);
    acc.observe('ff_unleash_edge_request_duration_seconds', { op: i % 5 === 0 ? 'features' : 'evaluate', result: fail ? 'error' : 'ok' }, (lognormal(0.008, 0.5, 'edge', m, i) * (edgeBad ? 12 : 1)));
  }

  // HTTP API — 화면(KR 업무 시간)과 차량 경로
  const ui = activity('KR', t) * 30 + 2;
  const routes: [string, string, number, number][] = [
    ['GET', '/api/features', ui, 0.04],
    ['GET', '/api/policies', ui * 0.6, 0.03],
    ['GET', '/api/fleet/map', ui * 0.3, 0.12],
    ['GET', '/api/health/metrics', 4, 0.005],
    ['POST', '/vehicle/v1/:vin/status', model.cells.reduce((n, c) => n + c.vehicles * (activity(c.country, t) * 0.1 + 0.008), 0), 0.012],
    ['POST', '/ofrep/v1/evaluate/flags/:key', edgeCalls, edgeBad ? 0.05 : 0.009],
    ['POST', '/api/telemetry/readback', 3, 0.02],
  ];
  for (const [method, route, rate, median] of routes) {
    const n = draw(rate, 'http', route, m);
    for (let i = 0; i < n; i++) {
      const r = rand('http-s', route, m, i);
      const status = r < (edgeBad && route.startsWith('/ofrep') ? 0.02 : 0.0015) ? 503 : r < 0.01 ? (method === 'GET' ? 404 : 400) : 200;
      acc.inc('ff_http_requests_total', { method, route, status }, 1);
      acc.observe('ff_http_request_duration_seconds', { method, route }, lognormal(median, 0.6, 'http-d', route, m, i));
    }
  }
  const annotate = (type: string, every: number, offset: number) => m % every === offset && acc.inc('ff_events_total', { type }, 1);
  annotate('sync.completed', 60, 7);
  if (m === Math.floor((day * DAY + 3 * 3_600_000) / MIN) && ((day % 14) + 14) % 14 in { 0: 1, 3: 1, 6: 1, 9: 1 }) {
    acc.inc('ff_events_total', { type: 'rollout.staged' }, 1);
    log('rollout.staged', 9, { feature: CANARY_FEATURE, stage_ratio: canaryStage(t) });
  }

  // Feature 운영 건강도(Data Lake Gold)
  for (const fv of model.versions) {
    const a = activity(fv.country, t);
    const vehicles = fv.eligible * fv.share(t);
    const active = vehicles * a * fv.adoption;
    const L = { feature: fv.featureId, feature_version: fv.version, country: fv.country, vehicle_model: fv.model, cohort: fv.cohort };
    const key = `${fv.featureId}@${fv.version}`;
    const acts = draw(active * 0.15, 'act', key, m);
    acc.inc('ff_feature_usage_seconds_total', L, Math.round(active * 60 * (0.55 + 0.3 * rand('eng', key))));
    acc.inc('ff_feature_activations_total', L, acts);
    acc.inc('ff_feature_manual_off_total', L, draw(acts * fv.offRate, 'off', key, m));
    acc.inc('ff_feature_quick_off_total', L, draw(acts * fv.quickRate, 'qo', key, m));
    const fb = draw(acts * fv.fallbackRate(t, fv.model) + (killed.has(fv.featureId) ? acts * 0.8 : 0), 'fb', key, m);
    for (let i = 0; i < fb; i++) {
      const r = rand('fb-r', key, m, i);
      const reason = killed.has(fv.featureId) && r < 0.8 ? 'KILL_SWITCH' : r < 0.5 ? 'CONTEXT_UNKNOWN' : r < 0.7 ? 'ERROR_SAFE_DEFAULT' : 'NOT_SUPPORTED';
      acc.inc('ff_feature_fallbacks_total', { ...L, reason }, 1);
    }
    acc.inc('ff_feature_errors_total', L, draw(active * fv.errorRate, 'ferr', key, m));
    acc.inc('ff_feature_dtc_total', L, draw(active * fv.dtcRate(t), 'fdtc', key, m));
  }
  if (ev) ev.logs.push(...logs);
}

// ── 순간값(gauge) ───────────────────────────────────────────
function gauges(model: DemoModel, t: number): { name: string; labels: Labels; value: number }[] {
  const out: { name: string; labels: Labels; value: number }[] = [];
  const g = (name: string, labels: Labels, value: number) => out.push({ name, labels, value });
  const day = dayIndex(t);
  for (const c of model.cells) {
    g('ff_vehicles_registered', { country: c.country, vehicle_model: c.model, sw_version: c.sw }, c.vehicles);
  }
  const byCm = new Map<string, { country: string; model: string; n: number; lambda1h: number; cells: string[] }>();
  for (const c of model.cells) {
    const k = `${c.country}|${c.model}`;
    const e = byCm.get(k) ?? { country: c.country, model: c.model, n: 0, lambda1h: 0, cells: [] };
    let lam = 0;
    for (let i = 0; i < 60; i += 5) lam += (activity(c.country, t - i * MIN) * 0.1 + 0.008) * (1 - outage(c.key, t - i * MIN).drop) * 5;
    e.lambda1h = (e.lambda1h * e.n + lam * c.vehicles) / (e.n + c.vehicles);
    e.n += c.vehicles;
    e.cells.push(c.key);
    byCm.set(k, e);
  }
  for (const e of byCm.values()) {
    const offline = (e.country === 'US' ? 0.04 : 0.015) * (0.8 + 0.4 * rand('offl', e.country, e.model, day));
    g('ff_vehicles_silent', { country: e.country, vehicle_model: e.model, window: '1h' }, Math.round(e.n * (offline + (1 - offline) * Math.exp(-e.lambda1h))));
    g('ff_vehicles_silent', { country: e.country, vehicle_model: e.model, window: '24h' }, Math.round(e.n * offline));
  }
  for (const inc of [...model.incidents(day - 1), ...model.incidents(day)]) {
    if (t < inc.issued || t >= inc.released) continue;
    const pending = Array.from({ length: inc.targets }, (_, v) => model.applySeconds(inc, v)).filter((s) => inc.issued + s * 1000 > t).length;
    g('ff_kill_target_vehicles', { feature: inc.featureId, deact_class: inc.dc }, inc.targets);
    g('ff_kill_pending_vehicles', { feature: inc.featureId, deact_class: inc.dc }, pending);
  }
  for (const p of model.catalog.policies.filter((x) => x.status === 'DEPLOYED')) {
    g('ff_flag_info', { flag: p.flagKey, policy: p.policyId, feature: p.featureId, feature_version: p.featureVersion, f_class: p.fClass }, 1);
    g('ff_rollout_stage_ratio', { flag: p.flagKey, policy: p.policyId, feature: p.featureId }, p.stageRatio);
    g('ff_unleash_drift', { flag: p.flagKey }, driftWindow(t) && p.flagKey === model.catalog.policies.filter((x) => x.status === 'DEPLOYED').at(-1)?.flagKey ? 1 : 0);
  }
  for (const [i, sys] of ['GITLAB', 'JIRA', 'CODEBEAMER'].entries()) g('ff_ext_outbox_pending', { system: sys }, Math.floor(3 * rand('outbox', sys, Math.floor(t / (10 * MIN)))) + (((t / 3_600_000) % 24) - i === 6 ? 14 : 0));
  const uptime0 = Math.floor(t / (7 * DAY)) * 7 * DAY + 2 * 3_600_000;
  g('ff_process_uptime_seconds', {}, Math.max(0, Math.round((t - (t >= uptime0 ? uptime0 : uptime0 - 7 * DAY)) / 1000)));
  g('ff_process_resident_memory_bytes', {}, Math.round((380 + 40 * Math.sin(t / 3_600_000) + 10 * rand('rss', Math.floor(t / MIN))) * 1024 * 1024));
  g('ff_process_heap_used_bytes', {}, Math.round((150 + 30 * Math.sin(t / 1_800_000) + 8 * rand('heap', Math.floor(t / MIN))) * 1024 * 1024));
  // Feature 건강도 — Lake 4축 입력 지표(이번 창 값)
  const killed = new Set([...model.incidents(day - 1), ...model.incidents(day)].filter((i) => t >= i.issued && t < i.released).map((i) => i.featureId));
  for (const fv of model.versions) {
    const L = { feature: fv.featureId, feature_version: fv.version, country: fv.country, vehicle_model: fv.model, cohort: fv.cohort };
    const active = fv.eligible * fv.share(t) * activity(fv.country, t) * fv.adoption;
    g('ff_feature_active_vehicles', L, Math.round(active));
    const key = `${fv.featureId}@${fv.version}`;
    const ind: Record<string, number> = {
      delivery_success_rate: 0.985 + 0.013 * rand('dsr', key, day),
      status_rejected_rate: 0.002 + 0.002 * rand('srr', key, day),
      disabled_share: killed.has(fv.featureId) ? 0.6 + 0.3 * rand('ds', key, day) : 0,
      dtc_vehicle_rate: fv.dtcRate(t) * 40,
      fault_rate_per_1k: fv.errorRate * 1000 * 6,
      safety_event_rate_per_1k: 0.2 + 0.3 * rand('ser', key, day),
      incident_count: Math.floor(2 * rand('ic', key, day)),
      usage_rate: fv.adoption,
      manual_off_rate: fv.offRate,
      trial_conversion_rate: 0.08 + 0.12 * rand('tcr', key),
      anomaly_open_count: Math.floor(1.5 * rand('aoc', key, day)) + (killed.has(fv.featureId) ? 1 : 0),
      security_alert_count: model.cells.some((c) => c.country === fv.country && c.model === fv.model && signatureAttack(c.key, t)) ? 1 : 0,
      data_missing_rate: 0.01 + 0.02 * rand('dmr', key, day),
    };
    for (const [indicator, value] of Object.entries(ind)) g('ff_feature_health_indicator', { feature: fv.featureId, feature_version: fv.version, axis: HEALTH_INDICATORS[indicator], indicator }, Number(value.toFixed(5)));
  }
  const fresh = (base: number, k: string) => Math.round(base * (0.6 + 0.8 * rand('fresh', k, Math.floor(t / (15 * MIN)))) + (rand('fresh-late', k, day) < 0.15 && ((t % DAY) / 3_600_000) % 24 > 20 ? 2400 : 0));
  g('ff_lake_freshness_seconds', { dataset: 'gold_5m' }, fresh(420, '5m'));
  g('ff_lake_freshness_seconds', { dataset: 'gold_1h' }, fresh(1500, '1h'));
  g('ff_lake_freshness_seconds', { dataset: 'gold_1d' }, fresh(9000, '1d'));
  g('ff_lake_freshness_seconds', { dataset: 'relay' }, fresh(40, 'relay'));
  return out;
}

export interface DemoBatch {
  platform: OtlpMetric[];
  lake: OtlpMetric[];
  events: DemoEvents;
  /** 보낸 시계열 수(Prometheus 기준: histogram은 경계 수 + 3) */
  activeSeries: number;
  points: number;
}

/**
 * 시각 times(오름차순, ms)의 지표 점과, eventsFrom 이후의 로그·추적을 만든다.
 * 누적 값은 각 점의 UTC 자정부터 센다 — 같은 시각이면 어떤 창으로 만들어도 같은 값.
 */
export function generate(catalog: DemoCatalog, times: number[], eventsFrom = Infinity): DemoBatch {
  if (!times.length) throw new Error('시각이 없다');
  const model = new DemoModel(catalog);
  const sorted = [...times].sort((a, b) => a - b);
  const snapshots: { t: number; acc: Acc }[] = [];
  let acc = new Acc();
  let curDay = dayIndex(sorted[0]);
  const events: DemoEvents = { logs: [], spans: [] };
  let mm = curDay * (DAY / MIN);
  for (const t of sorted) {
    const target = Math.floor(t / MIN);
    for (; mm < target; mm++) {
      if (dayIndex(mm * MIN) !== curDay) {
        curDay = dayIndex(mm * MIN);
        acc = new Acc();
      }
      minute(model, mm, acc, mm * MIN >= eventsFrom ? events : null);
    }
    if (dayIndex(t) !== curDay) {
      curDay = dayIndex(t);
      acc = new Acc();
    }
    snapshots.push({ t, acc: acc.clone() });
  }
  const sums = new Map<string, OtlpNumberPoint[]>();
  const hists = new Map<string, OtlpHistogramPoint[]>();
  const gs = new Map<string, OtlpNumberPoint[]>();
  const seriesKeys = new Set<string>();
  for (const { t, acc: a } of snapshots) {
    const ns = BigInt(t) * NS;
    const start = BigInt(dayStart(t)) * NS;
    for (const [name, fam] of a.counters) for (const s of fam.values()) {
      (sums.get(name) ?? sums.set(name, []).get(name)!).push({ attributes: s.labels as OtlpAttrs, startNs: start, timeNs: ns, value: s.value });
      seriesKeys.add(name + JSON.stringify(s.labels));
    }
    for (const [name, fam] of a.hists) for (const s of fam.values()) {
      (hists.get(name) ?? hists.set(name, []).get(name)!).push({ attributes: s.labels as OtlpAttrs, startNs: start, timeNs: ns, count: s.count, sum: s.sum, bucketCounts: s.buckets, bounds: metricDef(name)!.buckets ?? [] });
      seriesKeys.add(name + JSON.stringify(s.labels));
    }
    for (const x of gauges(model, t)) {
      (gs.get(x.name) ?? gs.set(x.name, []).get(x.name)!).push({ attributes: Object.fromEntries(Object.entries(x.labels).map(([k, v]) => [k, String(v)])), startNs: ns, timeNs: ns, value: x.value });
      seriesKeys.add(x.name + JSON.stringify(x.labels));
    }
  }
  const platform: OtlpMetric[] = [];
  const lake: OtlpMetric[] = [];
  const put = (name: string, m: OtlpMetric) => (SOURCE_OF(name) === 'lake' ? lake : platform).push(m);
  for (const [name, points] of sums) put(name, { name, description: metricDef(name)!.help, kind: 'sum', monotonic: true, points });
  for (const [name, points] of hists) put(name, { name, description: metricDef(name)!.help, kind: 'histogram', points });
  for (const [name, points] of gs) put(name, { name, description: metricDef(name)!.help, kind: 'gauge', points });
  let activeSeries = 0;
  for (const k of seriesKeys) {
    const name = k.slice(0, k.indexOf('{'));
    const d = metricDef(name)!;
    activeSeries += d.type === 'histogram' ? (d.buckets?.length ?? 0) + 3 : 1;
  }
  const points = [...platform, ...lake].reduce((n, m) => n + m.points.length, 0);
  return { platform, lake, events, activeSeries, points };
}

/** 창 끝(지금)에서 거꾸로 1분 간격 시각들 — 분 경계에 맞춘다(다시 보내도 같은 시각) */
export function windowTimes(nowMs: number, minutes: number): number[] {
  const end = Math.floor(nowMs / MIN) * MIN;
  return Array.from({ length: minutes }, (_, i) => end - (minutes - 1 - i) * MIN);
}

export { APPLY_LATENCY_BUCKETS, HTTP_BUCKETS };
