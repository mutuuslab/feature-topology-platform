// Grafana 연동(80-80) 시험 — 네트워크·Grafana·Docker 없이:
//  · OTLP 인코딩: 가짜 수신 서버가 받은 바이트(gzip protobuf)를 직접 풀어 지표·로그·추적·인증 머리글을 확인
//  · 비밀이 없으면 '비밀 없음'으로 실패(건너뛰기 성공 아님)
//  · 시연 생성기: 결정성(겹친 창 같은 값)·자정 재시작·카탈로그 ID 일치·시계열 예산·VIN 없음
//  · 대시보드·경보: 쿼리 속 지표 이름 = 카탈로그(백엔드 노출) 이름, 공개본에 변수 없음, 저장본 최신, 경보 라벨 ↔ FF 수신 규칙
//  · 프로비저닝: 가짜 Grafana API로 데이터 소스 찾기·업로드·공개 URL·경보·알림 정책(기존 경로 보존)
//  · 워크플로 YAML·Alloy 설정·compose 덧붙임
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parse as parseYaml } from 'yaml';
import { FF } from '../lib.ts';
import { decodeFields, fieldBytes, fieldString, fixedDouble } from '../../backend/src/kernel/otlp/otlp-proto.ts';
import { exposedSeriesNames, HEALTH_INDICATORS, TELEMETRY_METRICS } from '../../contracts/src/rules/telemetry-metrics.ts';
import { readCatalog } from './demo-catalog.ts';
import { activity, canaryStage, generate, windowTimes } from './demo-generator.ts';
import { alertRules, dashboards, metricNamesIn, publicVariant } from './dashboards.ts';
import { builtFiles, promExprs } from './build-dashboards.ts';
import { main as pushMain } from './push-demo-metrics.ts';
import { main as provisionMain, mergePolicy, pickDataSources, QUIET_TIMING } from './provision.ts';

const ROOT = join(FF, '..');
const catalog = readCatalog();
const KNOWN = new Set(exposedSeriesNames());

async function fakeServer(handle: (req: IncomingMessage, body: Buffer) => { status?: number; json?: unknown; raw?: Buffer }) {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const r = handle(req, Buffer.concat(chunks));
      res.writeHead(r.status ?? 200, { 'Content-Type': r.raw ? 'application/x-protobuf' : 'application/json' });
      res.end(r.raw ?? (r.json === undefined ? '' : JSON.stringify(r.json)));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const [log, err] = [console.log, console.error];
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = err;
  }
};

// ── OTLP 전송 ───────────────────────────────────────────
test('push-demo: 가짜 OTLP 수신기가 받은 gzip protobuf — 인증·자원·지표 이름·누적 합·히스토그램·로그·추적', async () => {
  const got: { path: string; auth: string; enc: string; body: Uint8Array }[] = [];
  const srv = await fakeServer((req, body) => {
    got.push({ path: req.url!, auth: String(req.headers.authorization), enc: String(req.headers['content-encoding']), body: new Uint8Array(gunzipSync(body)) });
    return { raw: Buffer.alloc(0) };
  });
  try {
    const env = { GRAFANA_OTLP_URL: `${srv.base}/otlp/`, GRAFANA_OTLP_INSTANCE_ID: '123456', GRAFANA_OTLP_TOKEN: 'glc_test' };
    const code = await quiet(() => pushMain(['node', 'x', '--now', '2026-11-06T09:30:00Z', '--window', '5', '--events', '5'], env));
    assert.equal(code, 0);
  } finally {
    await srv.close();
  }
  assert.ok(got.every((g) => g.auth === 'Basic ' + Buffer.from('123456:glc_test').toString('base64') && g.enc === 'gzip'));
  assert.deepEqual([...new Set(got.map((g) => g.path))].sort(), ['/otlp/v1/logs', '/otlp/v1/metrics', '/otlp/v1/traces']);
  const names = new Set<string>();
  const services = new Set<string>();
  let sums = 0;
  let hists = 0;
  for (const g of got.filter((x) => x.path.endsWith('/metrics'))) {
    for (const rm of fieldBytes(decodeFields(g.body), 1)) {
      const rmf = decodeFields(rm);
      for (const kv of fieldBytes(decodeFields(fieldBytes(rmf, 1)[0]), 1)) {
        const f = decodeFields(kv);
        if (fieldString(f, 1) === 'service.name') services.add(fieldString(decodeFields(fieldBytes(f, 2)[0]), 1));
      }
      for (const sm of fieldBytes(rmf, 2)) {
        for (const m of fieldBytes(decodeFields(sm), 2)) {
          const mf = decodeFields(m);
          const name = fieldString(mf, 1);
          names.add(name);
          const sum = fieldBytes(mf, 7)[0];
          if (sum) {
            sums++;
            const sf = decodeFields(sum);
            assert.equal(sf.find((x) => x.field === 2)?.value, 2n, `${name} 누적(CUMULATIVE)`);
            assert.equal(sf.find((x) => x.field === 3)?.value, 1n, `${name} 단조 증가`);
            const p = decodeFields(fieldBytes(sf, 1)[0]);
            const start = p.find((x) => x.field === 2)!.value as bigint;
            const time = p.find((x) => x.field === 3)!.value as bigint;
            assert.equal(start, BigInt(Date.parse('2026-11-06T00:00:00Z')) * 1_000_000n, `${name} 시작 = UTC 자정`);
            assert.ok(time <= BigInt(Date.parse('2026-11-06T09:30:00Z')) * 1_000_000n && time > start);
            assert.ok(fixedDouble(p.find((x) => x.field === 4)!.value as bigint) >= 0);
          }
          const h = fieldBytes(mf, 9)[0];
          if (h) {
            hists++;
            const p = decodeFields(fieldBytes(decodeFields(h), 1)[0]);
            const count = p.find((x) => x.field === 4)!.value as bigint;
            const counts = fieldBytes(p, 6)[0];
            const bounds = fieldBytes(p, 7)[0];
            assert.equal(counts.length / 8, bounds.length / 8 + 1, `${name} 칸 수 = 경계 + 1`);
            const dv = new DataView(counts.buffer, counts.byteOffset, counts.length);
            let total = 0n;
            for (let i = 0; i < counts.length; i += 8) total += dv.getBigUint64(i, true);
            assert.equal(total, count, `${name} 칸 합 = 개수`);
          }
        }
      }
    }
  }
  assert.deepEqual([...services].sort(), ['ff-datalake', 'ff-platform']);
  assert.ok(sums > 10 && hists > 2);
  for (const n of names) assert.ok(KNOWN.has(n) || TELEMETRY_METRICS.some((m) => m.name === n), `카탈로그에 없는 지표 ${n}`);
  for (const must of ['ff_vehicle_status_reports_total', 'ff_vehicles_silent', 'ff_flag_evaluations_total', 'ff_feature_active_vehicles', 'ff_feature_health_indicator', 'ff_vehicle_readback_latency_seconds'])
    assert.ok(names.has(must), `${must}를 보내야 한다`);
  // 로그 본문 — 개인정보(VIN·가명) 없음
  const logs = got.filter((g) => g.path.endsWith('/logs')).map((g) => Buffer.from(g.body).toString('latin1')).join('');
  assert.doesNotMatch(logs, /HMA-|KMH-|ego-01|pseudonym/);
});

test('push-demo: 표본 단위 거부(400 duplicate)는 경고로 세고 실패하지 않는다, 인증 오류(401)는 실패', async () => {
  let status = 400;
  const srv = await fakeServer(() => ({ status, json: { message: 'err-mimir-sample-duplicate-timestamp: the sample has been rejected because another sample with the same timestamp, but a different value, has already been ingested' } }));
  const env = { GRAFANA_OTLP_URL: `${srv.base}/otlp`, GRAFANA_OTLP_INSTANCE_ID: '1', GRAFANA_OTLP_TOKEN: 't' };
  const out: string[] = [];
  const log = console.log;
  console.log = (m: string) => out.push(String(m));
  try {
    assert.equal(await pushMain(['node', 'x', '--now', '2026-11-06T09:30:00Z', '--window', '2', '--events', '0'], env), 0);
    assert.match(out.join(' '), /일부 거부 요청 [1-9]/);
    status = 401;
    await assert.rejects(pushMain(['node', 'x', '--now', '2026-11-06T09:30:00Z', '--window', '2', '--events', '0'], env), /HTTP 401 \(Instance ID·토큰·쓰기 권한 확인\)/);
  } finally {
    console.log = log;
    await srv.close();
  }
});

test('push-demo·provision: 비밀이 없으면 "비밀 없음"으로 실패(종료 2) — 건너뛰기 성공이 아니다', async () => {
  const errors: string[] = [];
  const err = console.error;
  console.error = (m: string) => errors.push(String(m));
  try {
    assert.equal(await pushMain(['node', 'x'], {}), 2);
    assert.equal(await pushMain(['node', 'x'], { GRAFANA_OTLP_URL: 'https://otlp-gateway-prod-ap-northeast-0.grafana.net/otlp', GRAFANA_OTLP_INSTANCE_ID: 'abc', GRAFANA_OTLP_TOKEN: 't' }), 2);
    assert.equal(await provisionMain(['node', 'x'], { GRAFANA_STACK_URL: 'https://x.grafana.net' }), 2);
  } finally {
    console.error = err;
  }
  assert.match(errors[0], /^비밀 없음: GRAFANA_OTLP_URL, GRAFANA_OTLP_INSTANCE_ID, GRAFANA_OTLP_TOKEN/);
  assert.match(errors.join('\n'), /Instance ID/);
  assert.match(errors.at(-1)!, /^비밀 없음: GRAFANA_SA_TOKEN/);
  // dry-run은 비밀 없이 크기만 본다
  assert.equal(await quiet(() => pushMain(['node', 'x', '--dry-run', '--now', '2026-11-06T09:30:00Z', '--window', '3'], {})), 0);
});

// ── 시연 생성기 ─────────────────────────────────────────
test('시연 생성기: 같은 시각은 어떤 창으로 만들어도 같은 값, 누적은 하루 안에서 줄지 않고 UTC 자정에 다시 센다', () => {
  const at = (iso: string) => Date.parse(iso);
  const a = generate(catalog, windowTimes(at('2026-11-06T09:30:00Z'), 30));
  const b = generate(catalog, windowTimes(at('2026-11-06T09:45:00Z'), 30));
  const point = (batch: ReturnType<typeof generate>, name: string, t: number) => {
    const m = [...batch.platform, ...batch.lake].find((x) => x.name === name)!;
    return new Map(m.points.filter((p) => p.timeNs === BigInt(t) * 1_000_000n).map((p) => [JSON.stringify(p.attributes), 'value' in p ? p.value : p.count]));
  };
  const shared = at('2026-11-06T09:25:00Z');
  for (const name of ['ff_vehicle_status_reports_total', 'ff_feature_usage_seconds_total', 'ff_vehicle_readback_latency_seconds', 'ff_vehicles_silent'])
    assert.deepEqual(point(a, name, shared), point(b, name, shared), `${name} 겹친 시각의 값이 같다`);
  const series = [...a.platform].find((m) => m.name === 'ff_vehicle_status_reports_total')!;
  const byKey = new Map<string, number[]>();
  for (const p of series.points) byKey.set(JSON.stringify(p.attributes), [...(byKey.get(JSON.stringify(p.attributes)) ?? []), (p as { value: number }).value]);
  for (const [k, vs] of byKey) assert.ok(vs.every((v, i) => i === 0 || v >= vs[i - 1]), `누적 ${k} 줄지 않는다`);
  // 자정을 넘는 창 — 자정 뒤 점은 새 시작 시각
  const c = generate(catalog, windowTimes(at('2026-11-07T00:05:00Z'), 10));
  const starts = new Set(c.platform.find((m) => m.name === 'ff_vehicle_status_reports_total')!.points.map((p) => p.startNs));
  assert.deepEqual([...starts].sort(), [BigInt(at('2026-11-06T00:00:00Z')) * 1_000_000n, BigInt(at('2026-11-07T00:00:00Z')) * 1_000_000n]);
});

test('시연 생성기: FF 시연 데이터와 같은 ID·라벨만, 시계열은 무료 한도(활성 1만) 안, VIN 없음', () => {
  const b = generate(catalog, windowTimes(Date.parse('2026-11-06T23:50:00Z'), 30), Date.parse('2026-11-06T23:35:00Z'));
  assert.ok(b.activeSeries < 4000, `활성 시계열 ${b.activeSeries} — 무료 한도 1만의 40% 안`);
  const countries = new Set(catalog.fleet.map((c) => c.country));
  const models = new Set(catalog.fleet.map((c) => c.vehicleModel));
  const sws = new Set(catalog.fleet.map((c) => c.swVersion));
  const features = new Set([...catalog.features.map((f) => f.featureId), '-']);
  const flags = new Set(catalog.policies.map((p) => p.flagKey));
  for (const m of [...b.platform, ...b.lake]) {
    assert.ok(TELEMETRY_METRICS.some((d) => d.name === m.name), m.name);
    const def = TELEMETRY_METRICS.find((d) => d.name === m.name)!;
    for (const p of m.points) {
      const attrs = p.attributes as Record<string, string>;
      assert.deepEqual(Object.keys(attrs).sort(), [...def.labels].sort(), `${m.name} 라벨`);
      if ('country' in attrs) assert.ok(countries.has(attrs.country), `${m.name} 국가 ${attrs.country}`);
      if ('vehicle_model' in attrs) assert.ok(models.has(attrs.vehicle_model), `${m.name} 차종 ${attrs.vehicle_model}`);
      if ('sw_version' in attrs) assert.ok(sws.has(attrs.sw_version), `${m.name} SW ${attrs.sw_version}`);
      if ('feature' in attrs) assert.ok(features.has(attrs.feature), `${m.name} Feature ${attrs.feature}`);
      if ('flag' in attrs) assert.ok(flags.has(attrs.flag), `${m.name} Flag ${attrs.flag}`);
      if (m.name === 'ff_feature_health_indicator') assert.equal(HEALTH_INDICATORS[attrs.indicator], attrs.axis);
      assert.doesNotMatch(JSON.stringify(attrs), /HMA-|KMH-|ego-|lead-/);
    }
  }
  assert.ok(b.events.logs.length > 0 && b.events.spans.length > 0);
});

test('시연 생성기: 현지 시각 주행 정점·Canary 14일 주기·하루 긴급 차단', () => {
  // KR 오전 8시(UTC 23시)는 새벽 3시(UTC 18시)보다 주행이 많다
  assert.ok(activity('KR', Date.parse('2026-11-04T23:00:00Z')) > 3 * activity('KR', Date.parse('2026-11-04T18:00:00Z')));
  assert.ok(activity('US', Date.parse('2026-11-04T13:00:00Z')) > activity('US', Date.parse('2026-11-04T08:00:00Z')));
  const stages = new Set(Array.from({ length: 14 }, (_, d) => canaryStage(Date.parse('2026-11-01T12:00:00Z') + d * 86_400_000)));
  assert.deepEqual([...stages].sort(), [0.05, 0.25, 0.5, 1]);
  const day = generate(catalog, [Date.parse('2026-11-06T23:59:00Z')]);
  const kills = day.platform.find((m) => m.name === 'ff_kill_commands_total');
  const n = kills ? kills.points.reduce((s, p) => s + (p as { value: number }).value, 0) : 0;
  assert.ok(n >= 1 && n <= 2, `하루 긴급 차단 ${n}건`);
});

// ── 대시보드·경보 ─────────────────────────────────────────
test('대시보드·경보: 쿼리 속 지표 이름은 모두 카탈로그(백엔드·Lake 노출) 이름', () => {
  const unknown: string[] = [];
  for (const d of dashboards()) for (const n of metricNamesIn(d)) if (!KNOWN.has(n)) unknown.push(`${d.uid}: ${n}`);
  for (const r of alertRules()) for (const n of metricNamesIn({ expr: r.expr })) if (!KNOWN.has(n)) unknown.push(`${r.uid}: ${n}`);
  assert.deepEqual(unknown, []);
  // 차량 수신 핵심 지표는 대시보드가 실제로 쓴다
  const used = new Set(dashboards().flatMap((d) => metricNamesIn(d)));
  for (const n of ['ff_vehicle_status_reports_total', 'ff_vehicle_signature_checks_total', 'ff_vehicle_readback_latency_seconds_bucket', 'ff_vehicles_silent', 'ff_kill_apply_latency_seconds_bucket', 'ff_kill_pending_vehicles', 'ff_flag_evaluations_total', 'ff_feature_manual_off_total', 'ff_feature_quick_off_total', 'ff_unleash_drift', 'ff_ext_outbox_pending'])
    assert.ok(used.has(n), `대시보드가 ${n}를 쓴다`);
});

test('대시보드: 패널마다 설명·고유 id·24칸 안 배치, 데이터 소스는 자리표시만, FF 데이터 링크', () => {
  const uids = new Set<string>();
  for (const d of dashboards()) {
    assert.ok(!uids.has(d.uid));
    uids.add(d.uid);
    const ids = new Set<number>();
    for (const p of d.panels) {
      assert.ok(!ids.has(p.id as number), `${d.uid} 패널 id ${p.id}`);
      ids.add(p.id as number);
      const g = p.gridPos as { x: number; w: number };
      assert.ok(g.x + g.w <= 24, `${d.uid} ${p.title} 배치`);
      if (p.type !== 'row') assert.ok(String(p.description ?? '').length >= 15, `${d.uid} ${p.title} 설명`);
    }
    const s = JSON.stringify(d);
    for (const m of s.matchAll(/"uid":"(\$\{[A-Z_]+\})"/g)) assert.match(m[1], /^\$\{DS_(PROMETHEUS|LOKI|TEMPO)\}$/);
    assert.ok((d.annotations as { list: unknown[] }).list.length >= 4, `${d.uid} 주석`);
    assert.ok(s.includes('${ff_url}'), `${d.uid} FF로 가는 링크`);
  }
  assert.deepEqual([...uids].sort(), ['ff-canary', 'ff-feature-health', 'ff-flag-eval', 'ff-kill-switch', 'ff-ops-overview', 'ff-platform', 'ff-vehicle-telemetry']);
  assert.match(JSON.stringify(dashboards().find((d) => d.uid === 'ff-feature-health')), /\$\{ff_url\}\/features\/\$\{__data\.fields\.feature\}/);
});

test('공개본: 템플릿·전역 변수 없음($__rate_interval 등), FF 주소 고정, 로그인 대시보드 링크 없음', () => {
  for (const d of dashboards()) {
    const p = publicVariant(d, 'https://ff.example');
    const s = JSON.stringify(p);
    assert.equal(p.uid, `${d.uid}-public`);
    assert.deepEqual(p.templating.list, []);
    assert.doesNotMatch(s, /\$(?!\{(__(data|field|url_time_range|value)|DS_))[a-z_{]/i, `${d.uid} 공개본 변수`);
    assert.doesNotMatch(s, /"\/d\/ff-/);
    assert.ok(s.includes('https://ff.example/'));
  }
  // PromQL 겉 문법 — 괄호·중괄호·따옴표 짝
  for (const e of promExprs()) {
    let depth = 0;
    let brace = 0;
    for (const ch of e.expr.replace(/"[^"]*"/g, '""')) {
      depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
      brace += ch === '{' ? 1 : ch === '}' ? -1 : 0;
      assert.ok(depth >= 0 && brace >= 0, `${e.name}: ${e.expr}`);
    }
    assert.equal(depth, 0, e.name);
    assert.equal(brace, 0, e.name);
    assert.equal((e.expr.match(/"/g) ?? []).length % 2, 0, e.name);
  }
});

test('저장본(deploy/grafana)이 원천(dashboards.ts)과 같다', () => {
  for (const [f, text] of builtFiles()) assert.equal(readFileSync(f, 'utf8').split('\r\n').join('\n'), text, f);
});

test('경보: 축·심각도 라벨과 FF 수신 규칙(운영 관찰·이상 징후 종류)이 맞고, 런북에 규칙별 절이 있다', () => {
  const ops = readFileSync(join(FF, 'contracts', 'src', 'schemas', 'ops-observation.ts'), 'utf8');
  const axes = [...ops.matchAll(/ObservationAxis = z\.enum\(\[([^\]]+)\]/g)][0][1];
  const doc = readFileSync(join(ROOT, 'docs', '80-integration', '80-80-grafana-observability.md'), 'utf8');
  for (const r of alertRules()) {
    assert.equal(r.labels.ff_source, 'feature-platform');
    assert.ok(axes.includes(`'${r.labels.ff_axis}'`), `${r.uid} 축 ${r.labels.ff_axis}`);
    assert.ok(['critical', 'warning', 'info'].includes(r.labels.severity));
    if (r.labels.ff_anomaly_kind) assert.ok(['FEATURE_FAULT', 'DELIVERY', 'SECURITY'].includes(r.labels.ff_anomaly_kind) && r.labels.ff_axis !== 'IMPROVEMENT', r.uid);
    if (r.group === 'ff-feature-improvement' || r.labels.ff_anomaly_kind) assert.match(r.expr, /by \([^)]*feature/, `${r.uid}는 Feature 라벨을 남긴다`);
    assert.ok(doc.includes(`id="${r.uid}"`), `런북에 ${r.uid} 절`);
  }
});

// ── 프로비저닝 ───────────────────────────────────────────
test('provision: 가짜 Grafana API — 데이터 소스를 이름으로 찾고, 대시보드·공개 대시보드·경보·연락처·알림 정책(기존 경로 보존), 두 번째 실행은 갱신', async () => {
  const state = { folders: new Set<string>(), dashboards: new Map<string, any>(), publics: new Map<string, any>(), groups: new Map<string, any>(), contacts: new Map<string, any>(), policy: { receiver: 'grafana-default-email', routes: [{ receiver: 'team-x', object_matchers: [['team', '=', 'x']] }] } as any, calls: [] as string[], mute: null as any };
  const srv = await fakeServer((req, body) => {
    const url = req.url!;
    const m = req.method!;
    state.calls.push(`${m} ${url.split('?')[0]}`);
    const json = body.length ? JSON.parse(body.toString()) : undefined;
    if (req.headers.authorization !== 'Bearer sa-token') return { status: 401, json: { message: 'unauthorized' } };
    if (m === 'GET' && url.startsWith('/api/search')) return { json: [] };
    if (m === 'GET' && url === '/api/datasources') return { json: [{ uid: 'usage1', name: 'grafanacloud-usage', type: 'prometheus' }, { uid: 'prom1', name: 'grafanacloud-ffdemo-prom', type: 'prometheus' }, { uid: 'logs1', name: 'grafanacloud-ffdemo-logs', type: 'loki' }, { uid: 'tr1', name: 'grafanacloud-ffdemo-traces', type: 'tempo' }] };
    let mm: RegExpMatchArray | null;
    if ((mm = url.match(/^\/api\/folders\/([\w-]+)$/))) return state.folders.has(mm[1]) ? { json: { uid: mm[1] } } : { status: 404, json: {} };
    if (m === 'POST' && url === '/api/folders') return (state.folders.add(json.uid), { json: { uid: json.uid } });
    if (m === 'POST' && url === '/api/dashboards/db') return (state.dashboards.set(json.dashboard.uid, json), { json: { uid: json.dashboard.uid, status: 'success' } });
    if ((mm = url.match(/^\/api\/dashboards\/uid\/([\w-]+)\/public-dashboards\/?$/))) {
      if (m === 'GET') return state.publics.has(mm[1]) ? { json: state.publics.get(mm[1]) } : { status: 404, json: { messageId: 'publicdashboards.notFound' } };
      const pd = { uid: `pd-${mm[1]}`, accessToken: `tok${mm[1].replace(/\W/g, '')}`, ...json };
      state.publics.set(mm[1], pd);
      return { json: pd };
    }
    if ((mm = url.match(/^\/api\/dashboards\/uid\/([\w-]+)\/public-dashboards\/([\w-]+)$/)) && m === 'PATCH') return { json: { ...state.publics.get(mm[1]), ...json, patched: true } };
    if ((mm = url.match(/^\/api\/v1\/provisioning\/folder\/([\w-]+)\/rule-groups\/([\w-]+)$/))) {
      assert.equal(req.headers['x-disable-provenance'], 'true');
      // 실제 Grafana 13 검증 — __dashboardUid__와 __panelId__는 함께여야 하고(아니면 400), 패널 id는 숫자 문자열
      for (const r of json.rules) {
        const a = r.annotations ?? {};
        if (('__dashboardUid__' in a) !== ('__panelId__' in a)) return { status: 400, json: { message: 'invalid alert rule: both annotations __dashboardUid__ and __panelId__ must be specified' } };
        if ('__panelId__' in a && !/^\d+$/.test(a.__panelId__)) return { status: 400, json: { message: 'invalid __panelId__' } };
        if (r.orgID !== 1 || !r.title || !r.condition || !r.ruleGroup || r.folderUID !== mm[1]) return { status: 400, json: { message: 'invalid alert rule' } };
      }
      return (state.groups.set(mm[2], json), { json });
    }
    if (url === '/api/v1/provisioning/contact-points' && m === 'GET') return { json: [...state.contacts.values()] };
    if (url.startsWith('/api/v1/provisioning/contact-points')) return (state.contacts.set(json.uid, json), { status: m === 'POST' ? 202 : 202, json });
    if (url.startsWith('/api/v1/provisioning/mute-timings')) return m === 'GET' ? (state.mute ? { json: state.mute } : { status: 404, json: {} }) : ((state.mute = json), { status: 201, json });
    if (url === '/api/v1/provisioning/policies') return m === 'GET' ? { json: state.policy } : ((state.policy = json), { status: 202, json: {} });
    return { status: 404, json: { message: `no route ${m} ${url}` } };
  });
  const env = { GRAFANA_STACK_URL: srv.base, GRAFANA_SA_TOKEN: 'sa-token', FF_PUBLIC_URL: 'https://ff.example', FF_GRAFANA_WEBHOOK_URL: 'https://ff.example/api/webhooks/grafana/alerts', FF_GRAFANA_WEBHOOK_SECRET: 's'.repeat(40), GRAFANA_ALERT_EMAIL: 'ops@example.com' };
  const out: string[] = [];
  const log = console.log;
  console.log = (m: string) => out.push(String(m));
  try {
    assert.equal(await provisionMain(['node', 'x'], env), 0);
    assert.equal(await provisionMain(['node', 'x'], env), 0);
    assert.equal(state.mute, null, '받을 곳이 있으면 묵음 없음');
    assert.equal(state.policy.routes[0].receiver, 'FF 운영 관찰 webhook');
    assert.equal(state.policy.routes.length, 2, '기존 경로를 지우지 않고 FF 경로 하나만 둔다');
    assert.equal(state.policy.routes[0].mute_time_intervals, undefined);
    // 공개 시연(FF webhook·메일 없음) — 알림은 막고 경보는 그대로
    assert.equal(await provisionMain(['node', 'x', '--skip-public'], { GRAFANA_STACK_URL: env.GRAFANA_STACK_URL, GRAFANA_SA_TOKEN: env.GRAFANA_SA_TOKEN }), 0);
    assert.equal(state.mute.name, QUIET_TIMING);
    assert.deepEqual(state.policy.routes[0].mute_time_intervals, [QUIET_TIMING]);
    assert.equal(state.policy.routes[0].receiver, 'grafana-default-email');
    assert.equal(state.policy.routes.length, 2);
  } finally {
    console.log = log;
    await srv.close();
  }
  assert.equal(state.dashboards.size, 14);
  for (const [uid, d] of state.dashboards) {
    const s = JSON.stringify(d.dashboard);
    assert.doesNotMatch(s, /\$\{DS_/, `${uid} 자리표시가 남지 않는다`);
    assert.match(s, /"uid":"prom1"/);
    assert.doesNotMatch(s, /"uid":"usage1"/);
    assert.equal(d.folderUid, uid.endsWith('-public') ? 'ff-public' : 'ff-ops');
    assert.equal(d.overwrite, true);
  }
  assert.match(JSON.stringify(state.dashboards.get('ff-vehicle-telemetry').dashboard), /"uid":"logs1"/);
  assert.equal(state.publics.size, 7);
  assert.ok([...state.publics.keys()].every((k) => k.endsWith('-public')));
  assert.ok(state.calls.filter((c) => c.startsWith('PATCH')).length === 7, '두 번째 실행은 공개 대시보드를 갱신');
  assert.deepEqual([...state.groups.keys()].sort(), ['ff-feature-improvement', 'ff-flag', 'ff-kill', 'ff-platform', 'ff-vehicle']);
  for (const g of state.groups.values()) for (const r of g.rules) assert.equal(r.data[0].datasourceUid, 'prom1');
  assert.equal([...state.groups.values()].reduce((n, g) => n + g.rules.length, 0), 15);
  // 경보 패널 링크 — 실제로 그 대시보드에 있는 패널(행 아님)
  for (const g of state.groups.values())
    for (const r of g.rules) {
      const d = state.dashboards.get(r.annotations.__dashboardUid__).dashboard;
      assert.ok(d.panels.some((p: any) => String(p.id) === r.annotations.__panelId__ && p.type !== 'row'), `${r.uid} 패널 ${r.annotations.__panelId__}`);
    }
  const hook = state.contacts.get('ff-webhook');
  assert.equal(hook.settings.hmacConfig.header, 'X-Grafana-Alerting-Signature');
  assert.ok(state.contacts.has('ff-email'));
  assert.deepEqual(state.policy.routes[1].object_matchers, [['team', '=', 'x']], '기존 경로를 지우지 않는다');
  const text = out.join('\n');
  assert.match(text, new RegExp(`공개 ff-vehicle-telemetry: ${srv.base.replace(/[.]/g, '\\.')}/public-dashboards/tokffvehicletelemetrypublic`));
  assert.match(text, /gh variable set GRAFANA_PUBLIC_URL --body ".+\/public-dashboards\/tokffvehicletelemetrypublic"/);
  assert.match(text, /gh variable set GRAFANA_FEATURE_PUBLIC_URL/);
});

test('provision: 데이터 소스 선택·알림 정책 병합 단위', () => {
  assert.throws(() => pickDataSources([{ uid: 'u', name: 'grafanacloud-usage', type: 'prometheus' }]), /Prometheus 데이터 소스/);
  const t = mergePolicy({ receiver: 'r0', routes: [{ receiver: 'old', object_matchers: [['ff_source', '=', 'feature-platform']] }] }, [], 'r0');
  assert.equal(t.routes.length, 1);
  assert.equal(t.routes[0].receiver, 'r0');
  assert.equal(t.routes[0].routes[0].repeat_interval, '24h');
  assert.equal(t.routes[0].mute_time_intervals, undefined);
  // 받을 곳이 없으면(공개 시연) 알림을 막는다 — 경보 평가는 그대로
  assert.deepEqual(mergePolicy({ receiver: 'r0', routes: [] }, [], 'r0', true).routes[0].mute_time_intervals, [QUIET_TIMING]);
});

// ── 워크플로·설치 구성 ─────────────────────────────────────
test('워크플로 YAML: 15분 예약·수동 실행, 비밀 이름 고정, 의존성 없는 Node 실행, 비밀을 건너뛰지 않는다', () => {
  const demo = parseYaml(readFileSync(join(ROOT, '.github', 'workflows', 'grafana-demo.yml'), 'utf8'));
  assert.equal(demo.on.schedule[0].cron, '*/15 * * * *');
  assert.ok('workflow_dispatch' in demo.on);
  assert.deepEqual(demo.permissions, { contents: 'read' });
  const step = demo.jobs.send.steps.find((s: any) => String(s.run ?? '').includes('push-demo-metrics.ts'));
  assert.deepEqual(Object.keys(step.env).filter((k) => k.startsWith('GRAFANA_')).sort(), ['GRAFANA_OTLP_INSTANCE_ID', 'GRAFANA_OTLP_TOKEN', 'GRAFANA_OTLP_URL']);
  for (const k of ['GRAFANA_OTLP_URL', 'GRAFANA_OTLP_INSTANCE_ID', 'GRAFANA_OTLP_TOKEN']) assert.equal(step.env[k], `\${{ secrets.${k} }}`);
  assert.equal(step['continue-on-error'], undefined);
  assert.doesNotMatch(JSON.stringify(demo), /\$\{\{ inputs\.window \}\}"/);
  assert.ok(!demo.jobs.send.steps.some((s: any) => /npm (ci|install)/.test(String(s.run ?? ''))), '예약 실행은 의존성 설치 없이');
  const prov = parseYaml(readFileSync(join(ROOT, '.github', 'workflows', 'grafana-provision.yml'), 'utf8'));
  assert.ok('workflow_dispatch' in prov.on);
  assert.equal(prov.jobs.provision.if, "github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && github.ref == 'refs/heads/feat/grafana-telemetry')");
  assert.deepEqual(demo.on.push.branches, ['feat/grafana-telemetry']);
  const p = prov.jobs.provision.steps.find((s: any) => String(s.run ?? '').includes('provision.ts'));
  assert.equal(p.env.GRAFANA_STACK_URL, '${{ secrets.GRAFANA_STACK_URL }}');
  assert.equal(p.env.GRAFANA_SA_TOKEN, '${{ secrets.GRAFANA_SA_TOKEN }}');
  const scripts = [...JSON.stringify([demo, prov]).matchAll(/tools\/grafana\/([\w-]+\.ts)/g)].map((m) => m[1]);
  for (const s of new Set(scripts)) assert.ok(readFileSync(join(FF, 'tools', 'grafana', s), 'utf8').length > 0, s);
  const cf = readFileSync(join(ROOT, '.github', 'workflows', 'cloudflare.yml'), 'utf8');
  assert.match(cf, /VITE_GRAFANA_PUBLIC_URL: \$\{\{ vars\.GRAFANA_PUBLIC_URL \}\}/);
});

test('설치 구성: Alloy는 OTLP 게이트웨이 하나로, compose 덧붙임은 비밀을 필수로·호스트 포트 없음', () => {
  const alloy = readFileSync(join(FF, 'deploy', 'grafana', 'alloy', 'config.alloy'), 'utf8');
  for (const k of ['GRAFANA_OTLP_URL', 'GRAFANA_OTLP_INSTANCE_ID', 'GRAFANA_OTLP_TOKEN', 'FF_METRICS_TOKEN', 'FF_METRICS_TARGET']) assert.ok(alloy.includes(`sys.env("${k}")`), k);
  assert.match(alloy, /metrics_path\s+= "\/api\/health\/metrics"/);
  assert.match(alloy, /"job"\s+= "ff\/ff-platform"/);
  assert.equal((alloy.match(/\{/g) ?? []).length, (alloy.match(/\}/g) ?? []).length);
  for (const [file, app] of [[join(FF, 'deploy', 'cloud-vm', 'compose.grafana.yml'), 'app'], [join(FF, 'docker', 'unleash', 'compose.grafana.yml'), 'platform']] as const) {
    const c = parseYaml(readFileSync(file, 'utf8'));
    assert.equal(c.services[app].environment.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://alloy:4318');
    assert.equal(c.services.alloy.ports, undefined, `${file} 호스트 포트 없음`);
    for (const k of ['GRAFANA_OTLP_URL', 'GRAFANA_OTLP_INSTANCE_ID', 'GRAFANA_OTLP_TOKEN']) assert.match(c.services.alloy.environment[k], /:\?/, `${k} 필수`);
    assert.equal(c.services.alloy.environment.FF_METRICS_TARGET, `${app}:9101`);
    assert.match(c.services.alloy.image, /^grafana\/alloy:v\d+\.\d+\.\d+/);
  }
});
